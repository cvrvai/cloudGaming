"""Aggregate API router."""
from fastapi import APIRouter

from app.api.routes import admin_users, auth, bookings, dmaic, games, health, machines, session, stream, system

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(admin_users.router)
api_router.include_router(dmaic.router)
api_router.include_router(machines.router)
api_router.include_router(bookings.router)
api_router.include_router(session.router)
api_router.include_router(games.router)
api_router.include_router(health.router)
api_router.include_router(stream.router)
api_router.include_router(system.router)
