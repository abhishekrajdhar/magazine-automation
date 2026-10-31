from fastapi import APIRouter

from . import (
    auth,
    editorial,
    exports,
    health,
    indesign_bridge,
    integrations,
    jobs,
    media,
    orgs,
    planner,
    preflight,
    profiles,
    projects,
    references,
    templates,
)

api_router = APIRouter(prefix="/api/v1")
for module in (health, auth, orgs, projects, media, references, profiles, editorial, planner, templates, preflight,
               exports, jobs, integrations, indesign_bridge):
    api_router.include_router(module.router)
