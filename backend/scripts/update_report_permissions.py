"""
Script para agregar permisos de reportes a usuarios existentes
"""
import asyncio
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from app.core.db import async_engine
from app.api.auth.models import User
from app.core.permissions import BASIC_PERMISSIONS


async def update_user_permissions():
    """Actualiza los permisos de todos los usuarios para incluir report:financial:read"""
    
    async with AsyncSession(async_engine, expire_on_commit=False) as session:
        # Obtener todos los usuarios
        result = await session.execute(select(User))
        users = result.scalars().all()
        
        updated_count = 0
        
        for user in users:
            # Si el usuario no es admin y no tiene el permiso de reportes
            if not user.is_admin and "report:financial:read" not in (user.permissions or []):
                # Actualizar permisos con BASIC_PERMISSIONS
                user.permissions = BASIC_PERMISSIONS.copy()
                session.add(user)
                updated_count += 1
                print(f"✅ Actualizado usuario: {user.email}")
        
        # Guardar cambios
        await session.commit()
        
        print(f"\n🎉 Total de usuarios actualizados: {updated_count}")
        print(f"📊 Total de usuarios en DB: {len(users)}")


if __name__ == "__main__":
    print("🚀 Iniciando actualización de permisos...")
    asyncio.run(update_user_permissions())
    print("✅ Actualización completada")
