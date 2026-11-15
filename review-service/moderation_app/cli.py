import argparse,json
from .db import initialize,issue_key,connection
p=argparse.ArgumentParser();p.add_argument('command',choices=['init','create-key','list-keys','revoke-key']);p.add_argument('--tenant');p.add_argument('--actor');p.add_argument('--role',choices=['client','reviewer','admin']);p.add_argument('--key-id');args=p.parse_args();initialize()
if args.command=='create-key':
    if not all([args.tenant,args.actor,args.role]):p.error('tenant, actor and role are required')
    print(json.dumps({'tenant':args.tenant,'actor':args.actor,'role':args.role,'api_key':issue_key(args.tenant,args.actor,args.role)}))
if args.command=='list-keys':
    with connection() as db:print(json.dumps([dict(r) for r in db.execute('SELECT id,tenant,actor,role,active,created FROM api_keys ORDER BY created')]))
if args.command=='revoke-key':
    if not args.key_id:p.error('--key-id required')
    with connection(True) as db:print(json.dumps({'revoked':db.execute('UPDATE api_keys SET active=0 WHERE id=?',(args.key_id,)).rowcount}))
