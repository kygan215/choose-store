from sqlalchemy import inspect, text

from backend.database import engine, init_db


MIGRATIONS = {
    "stores": {
        "raw_address": "VARCHAR(500)",
        "standardized_address": "VARCHAR(500)",
        "geocode_level": "VARCHAR(40)",
        "location_source": "VARCHAR(40)",
    },
    "poi_results": {
        "business_area": "VARCHAR(120)",
    },
}


def run_migrations() -> None:
    inspector = inspect(engine)
    with engine.begin() as connection:
        for table, columns in MIGRATIONS.items():
            if table not in inspector.get_table_names():
                continue
            existing = {item["name"] for item in inspector.get_columns(table)}
            for name, sql_type in columns.items():
                if name not in existing:
                    connection.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {sql_type}'))
        connection.execute(text("CREATE INDEX IF NOT EXISTS idx_poi_results_business_area ON poi_results (business_area)"))
        connection.execute(text("PRAGMA optimize"))

if __name__ == "__main__":
    init_db()
    print("数据库初始化完成")
