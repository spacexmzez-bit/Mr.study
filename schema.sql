-- Enable foreign key enforcement
PRAGMA foreign_keys = ON;

-- 1. Users Table (Acts as shared identity table, compatible with Taskitator)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', -- 'user' or 'admin'
    streak_count INTEGER NOT NULL DEFAULT 0,
    last_activity_date TEXT, -- YYYY-MM-DD format
    streak_done BOOLEAN NOT NULL DEFAULT 0, -- Resets to 0 daily; 1 if points earned today
    streak_freeze_active BOOLEAN NOT NULL DEFAULT 0, -- Active consumable guard
    banch_balance INTEGER NOT NULL DEFAULT 0 CHECK (banch_balance >= 0),
    total_xp INTEGER NOT NULL DEFAULT 0,
    withdrawal_penalty_pct INTEGER NOT NULL DEFAULT 10 CHECK (withdrawal_penalty_pct BETWEEN 0 AND 100),
    is_taskitator_linked BOOLEAN NOT NULL DEFAULT 0,
    lang_pref TEXT NOT NULL DEFAULT 'en', -- 'en' or 'ar'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Rule Labels Table (Categorization for Rules)
CREATE TABLE IF NOT EXISTS rule_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, name)
);

-- 3. Rules Table (Range-based points & jump interval)
CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    min_points INTEGER NOT NULL CHECK (min_points >= 0),
    max_points INTEGER NOT NULL,
    jump_interval INTEGER NOT NULL DEFAULT 1 CHECK (jump_interval >= 1),
    type TEXT NOT NULL CHECK (type IN ('add', 'deduct')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES rule_labels(id) ON DELETE RESTRICT,
    CHECK (max_points >= min_points),
    CHECK (jump_interval <= (max_points - min_points + 1))
);

-- 4. Action Labels Table (Optional tagging during rule execution)
CREATE TABLE IF NOT EXISTS action_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, name)
);

-- 5. Activity Logs Table (Rolling 15 transactions per user)
CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    rule_name TEXT NOT NULL,
    delta INTEGER NOT NULL,
    banch_delta INTEGER NOT NULL,
    action_label TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 6. Store Items Table
CREATE TABLE IF NOT EXISTS store_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL CHECK (price >= 0),
    is_streak_freeze BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 7. User Inventory Table
CREATE TABLE IF NOT EXISTS user_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    total_bought INTEGER NOT NULL DEFAULT 0 CHECK (total_bought >= 0),
    unused_count INTEGER NOT NULL DEFAULT 0 CHECK (unused_count >= 0),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES store_items(id) ON DELETE CASCADE,
    UNIQUE (user_id, item_id)
);

-- 8. Challenges Table
CREATE TABLE IF NOT EXISTS challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    entry_cost INTEGER NOT NULL DEFAULT 0 CHECK (entry_cost >= 0),
    banch_prize INTEGER NOT NULL DEFAULT 0 CHECK (banch_prize >= 0),
    is_item_prize BOOLEAN NOT NULL DEFAULT 0,
    duration_days INTEGER NOT NULL CHECK (duration_days > 0),
    status TEXT NOT NULL DEFAULT 'Created' CHECK (status IN ('Created', 'Active', 'Completed', 'Failed', 'Abandoned')),
    start_date TEXT, -- YYYY-MM-DD
    finish_date TEXT, -- YYYY-MM-DD
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 9. Challenge Prize Items Table (For multi-item challenge rewards)
CREATE TABLE IF NOT EXISTS challenge_prize_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
);

-- 10. Challenge Activity History Table (Rolling 25 records per user)
CREATE TABLE IF NOT EXISTS challenge_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    challenge_title TEXT NOT NULL,
    final_status TEXT NOT NULL CHECK (final_status IN ('Completed', 'Failed', 'Abandoned')),
    entry_cost INTEGER NOT NULL,
    refunded_or_awarded TEXT,
    finished_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 11. Shared Bridge Table (Ready for Taskitator Integration)
CREATE TABLE IF NOT EXISTS task_study_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    taskitator_task_id INTEGER,
    mr_study_rule_id INTEGER,
    challenge_id INTEGER,
    points_value INTEGER NOT NULL,
    points_awarded BOOLEAN NOT NULL DEFAULT 0,
    processed_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (mr_study_rule_id) REFERENCES rules(id) ON DELETE SET NULL,
    FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE SET NULL
);
