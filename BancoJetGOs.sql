-- =====================================================
-- DATABASE SCHEMA - CHATBOT PLATFORM
-- PostgreSQL
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- ORGANIZATIONS
-- =====================================================
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    plan VARCHAR(100),
    max_connections INT DEFAULT 1,
    max_chatbots INT DEFAULT 1,
    settings JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- USERS
-- =====================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_users_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE CASCADE
);

-- =====================================================
-- FLOWS
-- =====================================================
CREATE TABLE flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chatbot_id UUID,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50),
    version INT DEFAULT 1,
    metadata JSONB,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- CHATBOTS
-- =====================================================
CREATE TABLE chatbots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    active_flow_id UUID,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    inactivity_timeout_ms INT,
    max_retries INT DEFAULT 3,
    send_delay_ms INT DEFAULT 0,
    ai_config JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_chatbots_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_chatbots_active_flow
        FOREIGN KEY (active_flow_id)
        REFERENCES flows(id)
        ON DELETE SET NULL
);

ALTER TABLE flows
ADD CONSTRAINT fk_flows_chatbot
FOREIGN KEY (chatbot_id)
REFERENCES chatbots(id)
ON DELETE CASCADE;

-- =====================================================
-- FLOW NODES
-- =====================================================
CREATE TABLE flow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id UUID NOT NULL,
    type VARCHAR(100) NOT NULL,
    label VARCHAR(255),
    data JSONB,
    position_x FLOAT,
    position_y FLOAT,
    retry_limit INT DEFAULT 0,
    error_message VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_flow_nodes_flow
        FOREIGN KEY (flow_id)
        REFERENCES flows(id)
        ON DELETE CASCADE
);

-- =====================================================
-- FLOW EDGES
-- =====================================================
CREATE TABLE flow_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id UUID NOT NULL,
    source_node_id UUID NOT NULL,
    target_node_id UUID NOT NULL,
    condition_type VARCHAR(100),
    condition_value VARCHAR(255),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_flow_edges_flow
        FOREIGN KEY (flow_id)
        REFERENCES flows(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_flow_edges_source
        FOREIGN KEY (source_node_id)
        REFERENCES flow_nodes(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_flow_edges_target
        FOREIGN KEY (target_node_id)
        REFERENCES flow_nodes(id)
        ON DELETE CASCADE
);

-- =====================================================
-- WHATSAPP CONNECTIONS
-- =====================================================
CREATE TABLE whatsapp_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    chatbot_id UUID,
    instance_name VARCHAR(255),
    phone_number VARCHAR(50),
    status VARCHAR(50),
    connection_type VARCHAR(50),
    api_key VARCHAR(255),
    webhook_url VARCHAR(500),
    qr_code_data JSONB,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_whatsapp_connections_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_whatsapp_connections_chatbot
        FOREIGN KEY (chatbot_id)
        REFERENCES chatbots(id)
        ON DELETE SET NULL
);

-- =====================================================
-- CONTACTS
-- =====================================================
CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    phone VARCHAR(50) NOT NULL,
    name VARCHAR(255),
    profile_pic_url VARCHAR(500),
    custom_fields JSONB,
    first_contact_at TIMESTAMPTZ,
    last_contact_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_contacts_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE CASCADE
);

-- =====================================================
-- CONVERSATIONS
-- =====================================================
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    contact_id UUID NOT NULL,
    chatbot_id UUID,
    whatsapp_connection_id UUID,
    status VARCHAR(50),
    close_reason VARCHAR(255),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_conversations_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_conversations_contact
        FOREIGN KEY (contact_id)
        REFERENCES contacts(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_conversations_chatbot
        FOREIGN KEY (chatbot_id)
        REFERENCES chatbots(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_conversations_whatsapp_connection
        FOREIGN KEY (whatsapp_connection_id)
        REFERENCES whatsapp_connections(id)
        ON DELETE SET NULL
);

-- =====================================================
-- CONVERSATION STATES
-- =====================================================
CREATE TABLE conversation_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    current_node_id UUID,
    retry_count INT DEFAULT 0,
    awaiting_input_type VARCHAR(100),
    context JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_conversation_states_conversation
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_conversation_states_node
        FOREIGN KEY (current_node_id)
        REFERENCES flow_nodes(id)
        ON DELETE SET NULL
);

-- =====================================================
-- MESSAGES
-- =====================================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    flow_node_id UUID,
    direction VARCHAR(20) NOT NULL,
    content_type VARCHAR(50),
    body TEXT,
    media_url VARCHAR(500),
    metadata JSONB,
    delivery_status VARCHAR(50),
    retry_attempts INT DEFAULT 0,
    external_id VARCHAR(255),
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_messages_conversation
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_messages_flow_node
        FOREIGN KEY (flow_node_id)
        REFERENCES flow_nodes(id)
        ON DELETE SET NULL
);

-- =====================================================
-- CAPTURED VARIABLES
-- =====================================================
CREATE TABLE captured_variables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    flow_node_id UUID,
    variable_name VARCHAR(255) NOT NULL,
    variable_value TEXT,
    is_sensitive BOOLEAN DEFAULT FALSE,
    captured_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_captured_variables_conversation
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_captured_variables_flow_node
        FOREIGN KEY (flow_node_id)
        REFERENCES flow_nodes(id)
        ON DELETE SET NULL
);

-- =====================================================
-- KNOWLEDGE BASES
-- =====================================================
CREATE TABLE knowledge_bases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    chatbot_id UUID,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    embedding_model VARCHAR(255),
    chunk_size INT,
    chunk_overlap INT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_knowledge_bases_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_knowledge_bases_chatbot
        FOREIGN KEY (chatbot_id)
        REFERENCES chatbots(id)
        ON DELETE SET NULL
);

-- =====================================================
-- KNOWLEDGE DOCUMENTS
-- =====================================================
CREATE TABLE knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID NOT NULL,
    title VARCHAR(255),
    source_type VARCHAR(100),
    source_url VARCHAR(500),
    status VARCHAR(50),
    total_chunks INT DEFAULT 0,
    error_message TEXT,
    metadata JSONB,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_knowledge_documents_knowledge_base
        FOREIGN KEY (knowledge_base_id)
        REFERENCES knowledge_bases(id)
        ON DELETE CASCADE
);

-- =====================================================
-- TICKETS
-- =====================================================
CREATE TABLE tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    assigned_to UUID,
    ticket_number VARCHAR(100) UNIQUE,
    status VARCHAR(50),
    priority VARCHAR(50),
    subject VARCHAR(255),
    notes TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_tickets_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_tickets_conversation
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_tickets_assigned_to
        FOREIGN KEY (assigned_to)
        REFERENCES users(id)
        ON DELETE SET NULL
);

-- =====================================================
-- AI LOGS
-- =====================================================
CREATE TABLE ai_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    conversation_id UUID,
    chatbot_id UUID,
    request_type VARCHAR(100),
    model VARCHAR(100),
    request_payload JSONB,
    response_payload JSONB,
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    latency_ms INT DEFAULT 0,
    status VARCHAR(50),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_ai_logs_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_ai_logs_conversation
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_ai_logs_chatbot
        FOREIGN KEY (chatbot_id)
        REFERENCES chatbots(id)
        ON DELETE SET NULL
);

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_chatbots_organization_id ON chatbots(organization_id);
CREATE INDEX idx_flows_chatbot_id ON flows(chatbot_id);
CREATE INDEX idx_flow_nodes_flow_id ON flow_nodes(flow_id);
CREATE INDEX idx_flow_edges_flow_id ON flow_edges(flow_id);
CREATE INDEX idx_contacts_organization_id ON contacts(organization_id);
CREATE INDEX idx_conversations_contact_id ON conversations(contact_id);
CREATE INDEX idx_conversations_chatbot_id ON conversations(chatbot_id);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_ai_logs_created_at ON ai_logs(created_at);
CREATE INDEX idx_knowledge_documents_knowledge_base_id ON knowledge_documents(knowledge_base_id);

-- =====================================================
-- END OF SCHEMA
-- =====================================================
