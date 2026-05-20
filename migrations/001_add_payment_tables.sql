-- ============================================================
--  SoberFolk Payment System Migration
--  Run this file AFTER the base schema is created
--  This adds payment, wallet, and withdrawal functionality
-- ============================================================

-- ============================================================
--  STEP 1: NEW ENUM TYPES
-- ============================================================

CREATE TYPE payment_status_type AS ENUM ('pending', 'processing', 'success', 'failed', 'refunded');

CREATE TYPE transaction_type AS ENUM ('credit', 'debit', 'withdrawal_request', 'withdrawal_processed', 'withdrawal_rejected');

CREATE TYPE withdrawal_status_type AS ENUM ('pending', 'processing', 'completed', 'rejected');

CREATE TYPE ride_payment_status AS ENUM ('pending', 'paid', 'failed');


-- ============================================================
--  STEP 2: NEW SEQUENCES
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS payments_id_seq;
CREATE SEQUENCE IF NOT EXISTS driver_wallets_id_seq;
CREATE SEQUENCE IF NOT EXISTS wallet_transactions_id_seq;
CREATE SEQUENCE IF NOT EXISTS withdrawal_requests_id_seq;


-- ============================================================
--  STEP 3: NEW TABLES
-- ============================================================

-- ---- payments ----
CREATE TABLE payments (
    id                  integer             NOT NULL DEFAULT nextval('payments_id_seq'::regclass),
    ride_id             integer             NOT NULL,
    consumer_id         integer             NOT NULL,
    driver_id           integer             NOT NULL,
    razorpay_order_id   varchar(100),
    razorpay_payment_id varchar(100),
    razorpay_signature  varchar(255),
    total_amount        integer             NOT NULL,  -- in paise
    platform_fee        integer             NOT NULL,  -- 20% in paise
    driver_amount       integer             NOT NULL,  -- 80% in paise
    status              payment_status_type NOT NULL DEFAULT 'pending'::payment_status_type,
    payment_method      varchar(50),
    failure_reason      text,
    retry_count         integer             NOT NULL DEFAULT 0,
    created_at          timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at        timestamp without time zone
);

-- ---- driver_wallets ----
CREATE TABLE driver_wallets (
    id                  integer             NOT NULL DEFAULT nextval('driver_wallets_id_seq'::regclass),
    driver_id           integer             NOT NULL,
    balance             integer             NOT NULL DEFAULT 0,
    total_earnings      integer             NOT NULL DEFAULT 0,
    total_withdrawn     integer             NOT NULL DEFAULT 0,
    pending_withdrawal  integer             NOT NULL DEFAULT 0,
    created_at          timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- ---- wallet_transactions ----
CREATE TABLE wallet_transactions (
    id                  integer             NOT NULL DEFAULT nextval('wallet_transactions_id_seq'::regclass),
    wallet_id           integer             NOT NULL,
    driver_id           integer             NOT NULL,
    type                transaction_type    NOT NULL,
    amount              integer             NOT NULL,  -- in paise
    reference_type      varchar(20),        -- 'payment' or 'withdrawal'
    reference_id        integer,            -- payment_id or withdrawal_request_id
    ride_id             integer,
    balance_before      integer             NOT NULL,
    balance_after       integer             NOT NULL,
    description         text,
    created_at          timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- ---- withdrawal_requests ----
CREATE TABLE withdrawal_requests (
    id                      integer                 NOT NULL DEFAULT nextval('withdrawal_requests_id_seq'::regclass),
    driver_id               integer                 NOT NULL,
    wallet_id               integer                 NOT NULL,
    amount                  integer                 NOT NULL,  -- in paise
    bank_account_holder     varchar(100),
    bank_account_number     varchar(20),
    bank_ifsc_code          varchar(11),
    upi_id                  varchar(100),
    status                  withdrawal_status_type  NOT NULL DEFAULT 'pending'::withdrawal_status_type,
    admin_notes             text,
    processed_by            integer,
    created_at              timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at              timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    processed_at            timestamp without time zone
);


-- ============================================================
--  STEP 4: PRIMARY KEYS
-- ============================================================

ALTER TABLE payments             ADD CONSTRAINT payments_pkey             PRIMARY KEY (id);
ALTER TABLE driver_wallets       ADD CONSTRAINT driver_wallets_pkey       PRIMARY KEY (id);
ALTER TABLE wallet_transactions  ADD CONSTRAINT wallet_transactions_pkey  PRIMARY KEY (id);
ALTER TABLE withdrawal_requests  ADD CONSTRAINT withdrawal_requests_pkey  PRIMARY KEY (id);


-- ============================================================
--  STEP 5: UNIQUE CONSTRAINTS
-- ============================================================

ALTER TABLE payments       ADD CONSTRAINT payments_razorpay_order_id_key UNIQUE (razorpay_order_id);
ALTER TABLE payments       ADD CONSTRAINT payments_ride_id_key           UNIQUE (ride_id);
ALTER TABLE driver_wallets ADD CONSTRAINT driver_wallets_driver_id_key   UNIQUE (driver_id);


-- ============================================================
--  STEP 6: FOREIGN KEYS
-- ============================================================

-- payments
ALTER TABLE payments ADD CONSTRAINT payments_ride_id_fkey
    FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_consumer_id_fkey
    FOREIGN KEY (consumer_id) REFERENCES consumers(id) ON DELETE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_driver_id_fkey
    FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;

-- driver_wallets
ALTER TABLE driver_wallets ADD CONSTRAINT driver_wallets_driver_id_fkey
    FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;

-- wallet_transactions
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_wallet_id_fkey
    FOREIGN KEY (wallet_id) REFERENCES driver_wallets(id) ON DELETE CASCADE;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_driver_id_fkey
    FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_ride_id_fkey
    FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE SET NULL;

-- withdrawal_requests
ALTER TABLE withdrawal_requests ADD CONSTRAINT withdrawal_requests_driver_id_fkey
    FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
ALTER TABLE withdrawal_requests ADD CONSTRAINT withdrawal_requests_wallet_id_fkey
    FOREIGN KEY (wallet_id) REFERENCES driver_wallets(id) ON DELETE CASCADE;


-- ============================================================
--  STEP 7: INDEXES
-- ============================================================

-- payments
CREATE INDEX idx_payments_ride_id ON public.payments USING btree (ride_id);
CREATE INDEX idx_payments_consumer_id ON public.payments USING btree (consumer_id);
CREATE INDEX idx_payments_driver_id ON public.payments USING btree (driver_id);
CREATE INDEX idx_payments_status ON public.payments USING btree (status);
CREATE INDEX idx_payments_razorpay_order ON public.payments USING btree (razorpay_order_id);
CREATE INDEX idx_payments_created ON public.payments USING btree (created_at);

-- driver_wallets
CREATE INDEX idx_driver_wallets_driver ON public.driver_wallets USING btree (driver_id);
CREATE INDEX idx_driver_wallets_balance ON public.driver_wallets USING btree (balance);

-- wallet_transactions
CREATE INDEX idx_wallet_transactions_wallet ON public.wallet_transactions USING btree (wallet_id);
CREATE INDEX idx_wallet_transactions_driver ON public.wallet_transactions USING btree (driver_id);
CREATE INDEX idx_wallet_transactions_type ON public.wallet_transactions USING btree (type);
CREATE INDEX idx_wallet_transactions_ride ON public.wallet_transactions USING btree (ride_id);
CREATE INDEX idx_wallet_transactions_created ON public.wallet_transactions USING btree (created_at DESC);

-- withdrawal_requests
CREATE INDEX idx_withdrawal_requests_driver ON public.withdrawal_requests USING btree (driver_id);
CREATE INDEX idx_withdrawal_requests_wallet ON public.withdrawal_requests USING btree (wallet_id);
CREATE INDEX idx_withdrawal_requests_status ON public.withdrawal_requests USING btree (status);
CREATE INDEX idx_withdrawal_requests_created ON public.withdrawal_requests USING btree (created_at DESC);


-- ============================================================
--  STEP 8: SEQUENCE OWNERSHIP
-- ============================================================

ALTER SEQUENCE payments_id_seq            OWNED BY payments.id;
ALTER SEQUENCE driver_wallets_id_seq      OWNED BY driver_wallets.id;
ALTER SEQUENCE wallet_transactions_id_seq OWNED BY wallet_transactions.id;
ALTER SEQUENCE withdrawal_requests_id_seq OWNED BY withdrawal_requests.id;


-- ============================================================
--  STEP 9: MODIFY EXISTING TABLES
-- ============================================================

-- Add payment_status to rides table
ALTER TABLE rides 
ADD COLUMN payment_status ride_payment_status NOT NULL DEFAULT 'pending'::ride_payment_status;

CREATE INDEX idx_rides_payment_status ON public.rides USING btree (payment_status);


-- ============================================================
--  Done! Payment schema added successfully.
-- ============================================================
