# Docker Cheatsheet

*Tags: docker, devops, cheatsheet, containers*

## Essential Commands

```bash
# Build with BuildKit and plain output
DOCKER_BUILDKIT=1 docker build -t myapp:latest . --progress=plain

# Inspect health and logs
docker inspect --format='{{json .State.Health}}' <container-id>
docker logs --tail 100 -f <container-id>

# Prune unused containers and build cache safely
docker container prune -f
docker builder prune --filter "until=24h" -f
```

## Production Dockerfile Best Practices
- Use minimal base images (e.g. node:22-alpine or distroless).
- Non-root user: USER node or create dedicated unprivileged user.
- Multi-stage build: separate dependencies, compile stage, and runtime artifact.
