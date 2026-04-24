-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'premium')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Analysis Tasks table
CREATE TABLE IF NOT EXISTS analysis_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    folder_path TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    total_videos INTEGER DEFAULT 0,
    completed_videos INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_analysis_tasks_user_id ON analysis_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_status ON analysis_tasks(status);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_created_at ON analysis_tasks(created_at DESC);

-- Video Results table
CREATE TABLE IF NOT EXISTS video_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES analysis_tasks(id) ON DELETE CASCADE,
    video_name VARCHAR(255) NOT NULL,
    transcript TEXT,
    metadata JSONB,
    duration INTEGER,
    file_size BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_results_task_id ON video_results(task_id);
CREATE INDEX IF NOT EXISTS idx_video_results_video_name ON video_results(video_name);

-- Evaluation Scores table
CREATE TABLE IF NOT EXISTS evaluation_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_result_id UUID REFERENCES video_results(id) ON DELETE CASCADE,
    criteria VARCHAR(50) NOT NULL,
    score DECIMAL(3,2) CHECK (score >= 0 AND score <= 10),
    feedback TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_scores_video_result_id ON evaluation_scores(video_result_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_scores_criteria ON evaluation_scores(criteria);

-- Permissions
-- Basic access for anon (for demo/unauthenticated access if needed, though mostly will be authenticated)
GRANT SELECT ON users TO anon;
GRANT SELECT ON analysis_tasks TO anon;
GRANT SELECT ON video_results TO anon;
GRANT SELECT ON evaluation_scores TO anon;

-- Full access for authenticated users
GRANT ALL PRIVILEGES ON users TO authenticated;
GRANT ALL PRIVILEGES ON analysis_tasks TO authenticated;
GRANT ALL PRIVILEGES ON video_results TO authenticated;
GRANT ALL PRIVILEGES ON evaluation_scores TO authenticated;

-- Allow anon to insert for demo purposes if needed, but strictly per TAD we should mostly rely on auth.
-- However, given this is a local tool often used without complex auth flows in early stages:
GRANT INSERT, UPDATE, DELETE ON analysis_tasks TO anon;
GRANT INSERT, UPDATE, DELETE ON video_results TO anon;
GRANT INSERT, UPDATE, DELETE ON evaluation_scores TO anon;
