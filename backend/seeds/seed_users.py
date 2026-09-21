
import os
import random
import json
from datetime import datetime, date
import psycopg
from dotenv import load_dotenv

# Configuración
load_dotenv()

# Obtener URL de la base de datos desde el .env
# Si estamos ejecutando desde el host, usamos DATABASE_URL del .env
# Si estamos en Docker, el host 'localhost' debe cambiarse por 'postgresql'
# Pero el usuario pidió generarlo en la raíz, así que asumimos ejecución local o ajustes según el instructivo.
DATABASE_URL = os.getenv("DATABASE_URL")

# Si la URL usa asyncpg o un esquema no soportado directamente por psycopg (v3), ajustamos
if DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace(
        "postgresql+psycopg://", "postgresql://")
    DATABASE_URL = DATABASE_URL.replace(
        "postgresql+asyncpg://", "postgresql://")

PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$eKsMifgzLofAkulpEOXBuA$YcNCLe6D0oC+6klIj0aY+fLqTVur97klOx5Kbe6O9t0"
PERMISSIONS = json.dumps(["user:me", "user:password"])

NAMES = ["Juan", "Maria", "Pedro", "Ana", "Luis", "Sofia", "Carlos", "Laura", "Diego", "Marta",
         "Jose", "Elena", "Miguel", "Lucia", "Javier", "Carmen", "Raul", "Isabel", "Fernando", "Rosa"]

SURNAMES = ["Gomez", "Rodriguez", "Perez", "Vazquez", "Lopez",
            "Martinez", "Gonzalez", "Sanchez", "Ramirez", "Torres"]


def generate_users(count=60):
    users = []
    for i in range(1, count + 1):
        first_name = random.choice(NAMES)
        last_name = random.choice(SURNAMES)
        username = f"{first_name.lower()}.{last_name.lower()}.{i}"
        email = f"{username}@example.com"
        id_number = f"{random.randint(10000000, 99999999)}"

        users.append({
            "email": email,
            "username": username,
            "password": PASSWORD_HASH,
            "first_name": first_name,
            "last_name": last_name,
            "identification_number": id_number,
            "permissions": PERMISSIONS,
            "is_active": True,
            "is_verified": True,
            "is_admin": False,
            "must_change_password": False,
            "is_social_auth": False,
            "created_at": datetime.now()
        })
    return users


def main():
    if not DATABASE_URL:
        print("❌ Error: No se encontró DATABASE_URL en el archivo .env")
        return

    print(f"🌱 Iniciando semilla de usuarios en: {DATABASE_URL.split('@')[-1]}")

    users = generate_users(60)

    try:
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                # Insertar usuarios
                for user in users:
                    cur.execute(
                        """
                        INSERT INTO "user" (
                            email, username, password, first_name, last_name, 
                            identification_number, permissions, is_active, 
                            is_verified, is_admin, must_change_password, 
                            is_social_auth, created_at
                        ) VALUES (
                            %(email)s, %(username)s, %(password)s, %(first_name)s, %(last_name)s, 
                            %(identification_number)s, %(permissions)s, %(is_active)s, 
                            %(is_verified)s, %(is_admin)s, %(must_change_password)s, 
                            %(is_social_auth)s, %(created_at)s
                        )
                        ON CONFLICT (email) DO NOTHING
                        """,
                        user
                    )
                conn.commit()
                print(
                    f"✅ Se han insertado los usuarios exitosamente.")

    except Exception as e:
        print(f"❌ Error durante la siembra: {e}")


if __name__ == "__main__":
    main()
