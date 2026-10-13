import logging
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import Base, engine, SessionLocal
from app.core.security import get_password_hash
from app.models import Role, User

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def init_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # 1. Seed Roles
        admin_role = db.query(Role).filter(Role.name == "ADMIN").first()
        if not admin_role:
            admin_role = Role(name="ADMIN", description="Administrador total del sistema")
            db.add(admin_role)
            db.commit()
            db.refresh(admin_role)
            logger.info("Rol ADMIN creado.")

        user_role = db.query(Role).filter(Role.name == "USER").first()
        if not user_role:
            user_role = Role(name="USER", description="Usuario estándar de backups")
            db.add(user_role)
            db.commit()
            db.refresh(user_role)
            logger.info("Rol USER creado.")

        # 2. Seed Super Admin User ONLY if no users exist in the system yet
        user_count = db.query(User).count()
        if user_count == 0:
            admin_user = User(
                email=settings.FIRST_SUPERUSER_EMAIL,
                hashed_password=get_password_hash(settings.FIRST_SUPERUSER_PASSWORD),
                full_name=settings.FIRST_SUPERUSER_NAME,
                role_id=admin_role.id,
                is_active=True
            )
            db.add(admin_user)
            db.commit()
            logger.info(f"Usuario Super Admin inicial creado: {settings.FIRST_SUPERUSER_EMAIL}")
    except Exception as e:
        logger.error(f"Error inicializando base de datos: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    init_db()
