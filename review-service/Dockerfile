FROM python:3.11-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -u 10001 -m moderator && mkdir /data && chown moderator:moderator /data
COPY moderation_app ./moderation_app
USER 10001
EXPOSE 8030
CMD ["uvicorn","moderation_app.main:app","--host","0.0.0.0","--port","8030","--workers","1","--no-access-log"]
