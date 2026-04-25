"""
Local PostgreSQL database client.
Provides a Supabase-compatible chain API (table().select().eq().execute())
backed by a local PostgreSQL instance.
"""
import uuid
from datetime import datetime
from typing import Optional, Any, List

import psycopg2
import psycopg2.extras
import psycopg2.pool

from api.core.config import settings
from api.core.logger import logger


class _Result:
    """Lightweight result wrapper with .data attribute."""
    __slots__ = ('data', 'count')

    def __init__(self, data: list, count: int = 0):
        self.data = data
        self.count = count


class LocalSupabase:
    """Local PostgreSQL implementation mimicking Supabase client interface."""

    def __init__(self):
        self._dsn = (
            f"host={settings.DB_HOST} "
            f"port={settings.DB_PORT} "
            f"dbname={settings.DB_NAME} "
            f"user={settings.DB_USER} "
            f"password={settings.DB_PASSWORD}"
        )
        self._pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2, maxconn=20, dsn=self._dsn
        )
        logger.info("PostgreSQL connection pool created (min=2, max=20).")
        self._ensure_tables()

    def _get_connection(self):
        conn = self._pool.getconn()
        conn.autocommit = False
        return conn

    def _put_connection(self, conn):
        """归还连接到连接池（而非关闭）。"""
        try:
            self._pool.putconn(conn)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Raw SQL helper (for JOIN queries, aggregations, etc.)
    # ------------------------------------------------------------------
    def raw_sql(self, sql: str, params: list = None) -> _Result:
        conn = self._get_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            cur.execute(sql, params or [])
            if cur.description:
                rows = cur.fetchall()
                result = [dict(r) for r in rows]
            else:
                result = []
            conn.commit()
            return _Result(result)
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cur.close()
            self._put_connection(conn)

    def raw_sql_count(self, sql: str, params: list = None) -> int:
        conn = self._get_connection()
        cur = conn.cursor()
        try:
            cur.execute(sql, params or [])
            row = cur.fetchone()
            return row[0] if row else 0
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cur.close()
            self._put_connection(conn)

    # ------------------------------------------------------------------
    # Table creation / migration
    # ------------------------------------------------------------------
    def _ensure_tables(self):
        conn = self._get_connection()
        cur = conn.cursor()

        try:
            cur.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'analysis_tasks'
            """)
            if not cur.fetchone():
                logger.info("Creating analysis_tasks table...")
                cur.execute("""
                    CREATE TABLE analysis_tasks (
                        id TEXT PRIMARY KEY,
                        folder_path TEXT NOT NULL,
                        status TEXT DEFAULT 'pending',
                        total_videos INTEGER DEFAULT 0,
                        completed_videos INTEGER DEFAULT 0,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        completed_at TIMESTAMPTZ
                    )
                """)
            else:
                cur.execute("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'analysis_tasks'
                """)
                columns = [row[0] for row in cur.fetchall()]
                if 'completed_at' not in columns:
                    logger.info("Adding column completed_at to analysis_tasks...")
                    cur.execute("ALTER TABLE analysis_tasks ADD COLUMN completed_at TIMESTAMPTZ")

            cur.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'video_results'
            """)
            if not cur.fetchone():
                logger.info("Creating video_results table...")
                cur.execute("""
                    CREATE TABLE video_results (
                        id TEXT PRIMARY KEY,
                        task_id TEXT NOT NULL REFERENCES analysis_tasks(id),
                        video_name TEXT,
                        transcript TEXT,
                        metadata JSONB,
                        case_id TEXT,
                        brand_model TEXT,
                        system_version TEXT,
                        function_domain TEXT,
                        scenario TEXT,
                        sequence TEXT,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW()
                    )
                """)
            else:
                cur.execute("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'video_results'
                """)
                columns = [row[0] for row in cur.fetchall()]
                for col_name in ['case_id', 'brand_model', 'system_version',
                                 'function_domain', 'scenario', 'sequence']:
                    if col_name not in columns:
                        logger.info(f"Adding column {col_name} to video_results...")
                        cur.execute(f"ALTER TABLE video_results ADD COLUMN {col_name} TEXT")

            cur.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'evaluation_scores'
            """)
            if not cur.fetchone():
                logger.info("Creating evaluation_scores table...")
                cur.execute("""
                    CREATE TABLE evaluation_scores (
                        id SERIAL PRIMARY KEY,
                        result_id TEXT NOT NULL REFERENCES video_results(id),
                        criteria TEXT NOT NULL,
                        score NUMERIC(4,2),
                        feedback TEXT,
                        details TEXT,
                        metric_code TEXT,
                        category TEXT,
                        selection_reason TEXT
                    )
                """)
            else:
                cur.execute("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'evaluation_scores'
                """)
                columns = [row[0] for row in cur.fetchall()]
                for col_name in ['metric_code', 'category', 'selection_reason']:
                    if col_name not in columns:
                        logger.info(f"Adding column {col_name} to evaluation_scores...")
                        cur.execute(f"ALTER TABLE evaluation_scores ADD COLUMN {col_name} TEXT")

            # 校正 SERIAL 序列，避免历史数据导入后 id 冲突。
            # PG 的 setval(seq, n) 要求 n>=1；表为空时 MAX(id) 为 NULL，
            # 必须用三参数形式 setval(seq, 1, false) 表示「下一个 nextval 返回 1」，
            # 否则会抛 NumericValueOutOfRange，导致 _ensure_tables 失败、API 启动崩溃。
            cur.execute("""
                SELECT CASE
                    WHEN (SELECT MAX(id) FROM evaluation_scores) IS NULL
                        THEN setval('evaluation_scores_id_seq', 1, false)
                    ELSE setval('evaluation_scores_id_seq',
                                (SELECT MAX(id) FROM evaluation_scores))
                END
            """)

            # Migration: ensure FK constraints use ON DELETE CASCADE so that
            # deleting a task automatically removes its video_results and
            # evaluation_scores rows. Idempotent: drops the old constraint
            # (if present) and recreates it with CASCADE.
            try:
                cur.execute("""
                    SELECT conname, confdeltype FROM pg_constraint
                    WHERE conrelid = 'video_results'::regclass
                      AND contype = 'f'
                      AND conname = 'video_results_task_id_fkey'
                """)
                row = cur.fetchone()
                if row and row[1] != 'c':
                    logger.info("Migrating video_results_task_id_fkey -> ON DELETE CASCADE")
                    cur.execute("ALTER TABLE video_results DROP CONSTRAINT video_results_task_id_fkey")
                    cur.execute(
                        "ALTER TABLE video_results "
                        "ADD CONSTRAINT video_results_task_id_fkey "
                        "FOREIGN KEY (task_id) REFERENCES analysis_tasks(id) ON DELETE CASCADE"
                    )

                cur.execute("""
                    SELECT conname, confdeltype FROM pg_constraint
                    WHERE conrelid = 'evaluation_scores'::regclass
                      AND contype = 'f'
                      AND conname = 'evaluation_scores_result_id_fkey'
                """)
                row = cur.fetchone()
                if row and row[1] != 'c':
                    logger.info("Migrating evaluation_scores_result_id_fkey -> ON DELETE CASCADE")
                    cur.execute("ALTER TABLE evaluation_scores DROP CONSTRAINT evaluation_scores_result_id_fkey")
                    cur.execute(
                        "ALTER TABLE evaluation_scores "
                        "ADD CONSTRAINT evaluation_scores_result_id_fkey "
                        "FOREIGN KEY (result_id) REFERENCES video_results(id) ON DELETE CASCADE"
                    )
            except Exception as mig_err:
                logger.warning(f"FK cascade migration skipped: {mig_err}")

            conn.commit()
            logger.info("PostgreSQL database tables initialized.")
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to initialize tables: {e}")
            raise
        finally:
            cur.close()
            self._put_connection(conn)

    # ------------------------------------------------------------------
    # Chain API
    # ------------------------------------------------------------------
    class Table:
        """Table accessor with Supabase-compatible chain API."""

        def __init__(self, db: 'LocalSupabase', table_name: str):
            self.db = db
            self.table_name = table_name
            self._where_parts: List[str] = []
            self._where_values: list = []
            self._order_clause: Optional[str] = None
            self._limit_val: Optional[int] = None
            self._offset_val: Optional[int] = None
            self._count_only: bool = False

        # ---- Query builders ----

        def select(self, columns: str = "*"):
            self._select_columns = columns
            return self

        def insert(self, data: Any):
            self._insert_data = data
            return self

        def update(self, data: dict):
            self._update_data = data
            return self

        def delete(self):
            self._is_delete = True
            return self

        def eq(self, column: str, value):
            self._where_parts.append(f"{column} = %s")
            self._where_values.append(value)
            return self

        def neq(self, column: str, value):
            self._where_parts.append(f"{column} != %s")
            self._where_values.append(value)
            return self

        def like(self, column: str, pattern: str):
            self._where_parts.append(f"{column} ILIKE %s")
            self._where_values.append(pattern)
            return self

        def gte(self, column: str, value):
            self._where_parts.append(f"{column} >= %s")
            self._where_values.append(value)
            return self

        def lte(self, column: str, value):
            self._where_parts.append(f"{column} <= %s")
            self._where_values.append(value)
            return self

        def is_(self, column: str, value):
            if value is None:
                self._where_parts.append(f"{column} IS NULL")
            else:
                self._where_parts.append(f"{column} IS %s")
                self._where_values.append(value)
            return self

        def in_(self, column: str, values: list):
            if values:
                placeholders = ", ".join(["%s"] * len(values))
                self._where_parts.append(f"{column} IN ({placeholders})")
                self._where_values.extend(values)
            return self

        def order(self, column: str, desc: bool = False):
            self._order_clause = f"{column} {'DESC' if desc else 'ASC'}"
            return self

        def limit(self, n: int):
            self._limit_val = n
            return self

        def offset(self, n: int):
            self._offset_val = n
            return self

        def count(self):
            self._count_only = True
            return self

        # ---- Helpers ----

        def _build_where(self) -> tuple:
            if not self._where_parts:
                return "", []
            clause = " WHERE " + " AND ".join(self._where_parts)
            return clause, list(self._where_values)

        def _serialize_value(self, v):
            if isinstance(v, (dict, list)):
                return psycopg2.extras.Json(v)
            if v == "now()":
                return datetime.now().astimezone()
            return v

        # ---- Execute ----

        def execute(self):
            conn = self.db._get_connection()
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            try:
                # --- INSERT ---
                if hasattr(self, '_insert_data'):
                    data = self._insert_data
                    if isinstance(data, dict):
                        data = [data]

                    all_returned = []
                    serial_pk_tables = {'evaluation_scores'}
                    for record in data:
                        if 'id' not in record and self.table_name in ('analysis_tasks', 'video_results', 'vehicles', 'test_cases'):
                            record['id'] = str(uuid.uuid4())

                        if self.table_name in serial_pk_tables:
                            record = {k: v for k, v in record.items() if k != 'id'}

                        columns = list(record.keys())
                        values = [self._serialize_value(v) for v in record.values()]

                        col_names = ", ".join(columns)
                        placeholders = ", ".join(["%s"] * len(columns))

                        sql = f"INSERT INTO {self.table_name} ({col_names}) VALUES ({placeholders}) RETURNING *"
                        cur.execute(sql, values)
                        row = cur.fetchone()
                        if row:
                            all_returned.append(dict(row))

                    conn.commit()
                    cur.close()
                    self.db._put_connection(conn)
                    return _Result(all_returned)

                # --- COUNT ---
                if self._count_only:
                    where_clause, params = self._build_where()
                    sql = f"SELECT COUNT(*) AS cnt FROM {self.table_name}{where_clause}"
                    cur.execute(sql, params)
                    row = cur.fetchone()
                    total = row['cnt'] if row else 0
                    cur.close()
                    self.db._put_connection(conn)
                    return _Result([], count=total)

                # --- SELECT ---
                if hasattr(self, '_select_columns'):
                    where_clause, params = self._build_where()
                    sql = f"SELECT {self._select_columns} FROM {self.table_name}{where_clause}"

                    if self._order_clause:
                        sql += f" ORDER BY {self._order_clause}"
                    if self._limit_val is not None:
                        sql += f" LIMIT {int(self._limit_val)}"
                    if self._offset_val is not None:
                        sql += f" OFFSET {int(self._offset_val)}"

                    cur.execute(sql, params)
                    rows = cur.fetchall()
                    result = [dict(r) for r in rows]
                    cur.close()
                    self.db._put_connection(conn)
                    return _Result(result)

                # --- UPDATE ---
                elif hasattr(self, '_update_data'):
                    set_parts = [f"{k} = %s" for k in self._update_data.keys()]
                    set_clause = ", ".join(set_parts)
                    values = [self._serialize_value(v) for v in self._update_data.values()]

                    where_clause, where_params = self._build_where()
                    sql = f"UPDATE {self.table_name} SET {set_clause}{where_clause} RETURNING *"
                    params = values + where_params

                    cur.execute(sql, params)
                    rows = cur.fetchall()
                    result = [dict(r) for r in rows]
                    conn.commit()
                    cur.close()
                    self.db._put_connection(conn)
                    return _Result(result)

                # --- DELETE ---
                elif hasattr(self, '_is_delete'):
                    where_clause, params = self._build_where()
                    sql = f"DELETE FROM {self.table_name}{where_clause} RETURNING *"
                    cur.execute(sql, params)
                    rows = cur.fetchall()
                    result = [dict(r) for r in rows]
                    conn.commit()
                    cur.close()
                    self.db._put_connection(conn)
                    return _Result(result)

                # Fallback
                cur.close()
                self.db._put_connection(conn)
                return _Result([])

            except Exception as e:
                conn.rollback()
                cur.close()
                self.db._put_connection(conn)
                raise e

    def table(self, table_name: str):
        return self.Table(self, table_name)


# Create global instance
supabase = LocalSupabase()
logger.info("PostgreSQL client initialized.")
