"""Consume the existing NarasiAhli classify API; never fall back to a local LLM.

This adapter does not create a classifier. It checks the API's structured output
against the same taxonomy and attaches provenance for the review workflow/UI.
"""
import json
import httpx
from .config import settings
from . import classifier


class PredictionAPIError(classifier.ClassificationError):
    def __init__(self, code, status=502, retry_after=None):
        super().__init__(code)
        self.status=status
        self.retry_after=retry_after


def enabled(tenant):
    return tenant in {x.strip() for x in settings.narasiahli_tenants.split(',') if x.strip()}


def _response(response):
    if response.status_code != 200:
        status=response.status_code if response.status_code in (401,403,413,422,429,502,503,504) else 502
        retry=response.headers.get('retry-after') if status==429 else None
        raise PredictionAPIError('narasiahli_http_'+str(response.status_code),status,retry)
    if len(response.content)>256000:
        raise PredictionAPIError('narasiahli_invalid_response')
    return response.json()


def classify(body):
    base=settings.narasiahli_api_base_url.rstrip('/')
    key=settings.narasiahli_api_key.get_secret_value()
    if not base or not key or not base.startswith(('http://','https://')):
        raise PredictionAPIError('narasiahli_not_configured',503)
    headers={'X-API-Key':key,'Accept':'application/json'}
    try:
        with httpx.Client(timeout=httpx.Timeout(120,connect=5),trust_env=False,follow_redirects=False) as client:
            remote=_response(client.get(base+'/taxonomy',headers=headers))
            local=classifier.taxonomy()
            # Fail closed if service policy changed; do not silently relabel rules.
            if remote.get('version')!=local['version'] or remote.get('categories')!=local['categories']:
                raise PredictionAPIError('narasiahli_policy_mismatch',409)
            data=_response(client.post(base+'/classify',headers=headers,json={
                'platform':body.platform,'content':body.content,'context':body.context,
            }))
        if data.get('platform')!='x' or data.get('taxonomy_version')!=remote['version']:
            raise ValueError('Policy identity mismatch')
        if type(data.get('needs_review')) is not bool or not isinstance(data.get('request_id'),str) or not data['request_id']:
            raise ValueError('Invalid prediction state/provenance')
        if data['needs_review']:
            assessment='needs_review'
        elif type(data.get('pelanggaran')) is bool:
            assessment='violation' if data['pelanggaran'] else 'no_violation'
        else:
            raise ValueError('Missing final boolean')
        # Reuse existing strict ID/quote/consistency validation, never another LLM.
        validated=classifier.enrich({
            'assessment':assessment,'explanation':data['explanation'],
            'findings':[{k:f[k] for k in ('rule_id','assessment','evidence','rationale')} for f in data['findings']],
            'missing_context':data['missing_context'],
        },body)
        if any(validated[k]!=data.get(k) for k in ('status','needs_review','pelanggaran')):
            raise ValueError('Contradictory upstream state')
        validated.update(prediction_provider='narasiahli',prediction_endpoint='/api/v1/external/moderation/classify',
                         prediction_request_id=data['request_id'])
        return validated
    except PredictionAPIError:
        raise
    except httpx.TimeoutException as exc:
        raise PredictionAPIError('narasiahli_timeout',504) from exc
    except (httpx.HTTPError,ValueError,KeyError,TypeError,AttributeError,json.JSONDecodeError) as exc:
        raise PredictionAPIError('narasiahli_invalid_response') from exc
