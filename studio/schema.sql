CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','photographer','social')),
  phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shoots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  shoot_date TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  location_link TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','shot','editing','done','cancelled')),
  created_by INTEGER,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shoot_members (
  shoot_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  response TEXT NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','going','not_going')),
  PRIMARY KEY (shoot_id, user_id)
);
CREATE TABLE IF NOT EXISTS shots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shoot_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shoot_id INTEGER NOT NULL,
  file TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT 'local',
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','edited','approved','rejected')),
  uploaded_by INTEGER,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'instagram',
  post_date TEXT NOT NULL,
  post_time TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','draft','scheduled','posted')),
  created_by INTEGER,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS post_photos (
  post_id INTEGER NOT NULL,
  photo_id INTEGER NOT NULL,
  PRIMARY KEY (post_id, photo_id)
);
CREATE INDEX IF NOT EXISTS idx_photos_shoot ON photos(shoot_id);
CREATE INDEX IF NOT EXISTS idx_shots_shoot ON shots(shoot_id);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shoot_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shoot_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  portfolio TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS shoot_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shoot_id INTEGER NOT NULL,
  at_time TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shoot_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shoot_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('suggestion','feedback')),
  text TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_shoot ON shoot_feedback(shoot_id);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  shoot_id INTEGER,
  text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shoot_id INTEGER,
  to_name TEXT NOT NULL,
  to_phone TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS month_targets (
  month TEXT PRIMARY KEY,
  reels INTEGER NOT NULL,
  statics INTEGER NOT NULL,
  carousels INTEGER
);
CREATE TABLE IF NOT EXISTS deliverables (
  month TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('reel','static','carousel')),
  slot INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  extra INTEGER NOT NULL DEFAULT 0,
  tag TEXT NOT NULL DEFAULT '',
  done_by INTEGER,
  done_at INTEGER,
  PRIMARY KEY (month, type, slot)
);
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('studio','resort','photographer','product_photographer','makeup','art_director','costume','props','model')),
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  maps TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT '',
  rating TEXT NOT NULL DEFAULT '',
  charge TEXT NOT NULL DEFAULT '',
  distance TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resources_kind ON resources(kind);
CREATE TABLE IF NOT EXISTS shoot_resources (
  shoot_id INTEGER NOT NULL,
  resource_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','declined')),
  fee TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (shoot_id, resource_id)
);
