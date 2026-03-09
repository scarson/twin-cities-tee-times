-- courses: static catalog of supported golf courses
CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_config TEXT NOT NULL, -- JSON
  booking_url TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_active_check TEXT
);

-- tee_times: cached tee time availability
CREATE TABLE tee_times (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL REFERENCES courses(id),
  date TEXT NOT NULL,        -- YYYY-MM-DD
  time TEXT NOT NULL,        -- HH:MM
  price REAL,
  holes INTEGER NOT NULL,    -- 9 or 18
  open_slots INTEGER NOT NULL,
  booking_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL   -- ISO 8601
);

CREATE INDEX idx_tee_times_course_date ON tee_times(course_id, date);

-- poll_log: debugging and freshness tracking
CREATE TABLE poll_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL REFERENCES courses(id),
  date TEXT NOT NULL,         -- YYYY-MM-DD (which date was polled)
  polled_at TEXT NOT NULL,   -- ISO 8601
  status TEXT NOT NULL,      -- 'success', 'error', 'no_data'
  tee_time_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX idx_poll_log_course_date ON poll_log(course_id, date, polled_at);
