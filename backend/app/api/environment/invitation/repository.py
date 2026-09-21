from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from typing import Optional, List
import uuid

from app.api.environment.invitation.models import (
    EnvironmentInvitation, EnvironmentInvitationUpdate
)
from app.services.pagination import paginate_query_async

class EnvironmentInvitationRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, invitation: EnvironmentInvitation) -> EnvironmentInvitation:
        self.db.add(invitation)
        await self.db.commit()
        await self.db.refresh(invitation)
        return invitation

    async def get_by_id(self, invitation_id: uuid.UUID) -> Optional[EnvironmentInvitation]:
        query = select(EnvironmentInvitation).where(
            EnvironmentInvitation.id == invitation_id,
            EnvironmentInvitation.is_active == True
        )
        result = await self.db.exec(query)
        return result.first()
    
    async def get_by_environment_and_email(self, env_id: uuid.UUID, email: str) -> Optional[EnvironmentInvitation]:
        query = select(EnvironmentInvitation).where(
            EnvironmentInvitation.environment_id == env_id,
            EnvironmentInvitation.email == email,
            EnvironmentInvitation.is_active == True
        )
        result = await self.db.exec(query)
        return result.first()

    async def get_all_by_environment(
        self,
        env_id: uuid.UUID,
        page: int = 1,
        per_page: int = 10
    ) -> dict:
        query = select(EnvironmentInvitation).where(
            EnvironmentInvitation.environment_id == env_id,
            EnvironmentInvitation.is_active == True
        )
        # Maybe order by date descending? created_at missing, assume ID or update model later.
        
        return await paginate_query_async(
            db=self.db,
            model=EnvironmentInvitation,
            base_query=query,
            page=page,
            per_page=per_page
        )

    async def delete(self, invitation_id: uuid.UUID) -> bool:
        invitation = await self.get_by_id(invitation_id)
        if not invitation:
            return False
            
        invitation.is_active = False
        self.db.add(invitation)
        await self.db.commit()
        return True
