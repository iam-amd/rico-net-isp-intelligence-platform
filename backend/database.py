from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

# 1. Load the secrets from the .env file
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

# 2. Create the "Engine" (The actual connection to Postgres)
# We check if the URL is loaded correctly to avoid "NoneType" errors
if not DATABASE_URL:
    raise ValueError("DATABASE_URL is missing! Check your .env file.")

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=1800,
    )

# 3. Create a "SessionLocal" class
# Each time a user requests data, we create a new "Session" (a conversation)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 4. Create a "Base" class
# Later, all our tables (Models) will inherit from this Base.
# It tells Python: "These classes are special SQL tables."
Base = declarative_base()

# 5. Dependency
# This is a helper function we will use later in our API.
# It opens a connection, does the work, and closes it automatically.
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
