"""Storage package for multi-tenant game save and profile management."""
from app.services.storage.save_manager import save_manager, SaveStateManager

__all__ = ["save_manager", "SaveStateManager"]
