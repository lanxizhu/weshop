import type { DatabaseAdapter } from './database.js'

const mysqlTableOptions = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'

const mysqlSchema = [
  `CREATE TABLE IF NOT EXISTS products (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(255) NOT NULL DEFAULT '',
    price DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK(price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
    description TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'on' CHECK(status IN ('on','off')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_products_status_updated (status, updated_at DESC, id DESC),
    INDEX idx_products_updated_at (updated_at DESC, id DESC),
    INDEX idx_products_category (category)
  ) ${mysqlTableOptions}`,
  `CREATE TABLE IF NOT EXISTS categories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ${mysqlTableOptions}`,
  `CREATE TABLE IF NOT EXISTS product_images (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_product_images_product (product_id),
    INDEX idx_product_images_url (url(255)),
    CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  ) ${mysqlTableOptions}`,
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    openid VARCHAR(128) NOT NULL UNIQUE,
    nick_name VARCHAR(255) NOT NULL DEFAULT '微信用户',
    avatar_url TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'normal',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_users_avatar_url (avatar_url(255))
  ) ${mysqlTableOptions}`,
  `CREATE TABLE IF NOT EXISTS admins (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(512) NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ${mysqlTableOptions}`,
  `CREATE TABLE IF NOT EXISTS system_settings (
    \`key\` VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ${mysqlTableOptions}`,
  `CREATE TABLE IF NOT EXISTS system_setting_defaults (
    \`key\` VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ${mysqlTableOptions}`,
  `CREATE TABLE IF NOT EXISTS addresses (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    receiver VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    province VARCHAR(100) NOT NULL DEFAULT '',
    city VARCHAR(100) NOT NULL DEFAULT '',
    district VARCHAR(100) NOT NULL DEFAULT '',
    detail TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_addresses_user (user_id),
    CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ${mysqlTableOptions}`,
  `CREATE TABLE IF NOT EXISTS product_skus (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK(price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
    image TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_product_skus_product (product_id),
    INDEX idx_product_skus_image (image(255)),
    CONSTRAINT fk_product_skus_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  ) ${mysqlTableOptions}`,
  `CREATE TABLE IF NOT EXISTS cart_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    sku_id BIGINT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_cart_items_user_sku (user_id, sku_id),
    INDEX idx_cart_items_user (user_id),
    INDEX idx_cart_items_product (product_id),
    INDEX idx_cart_items_sku (sku_id),
    CONSTRAINT fk_cart_items_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_cart_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_cart_items_sku FOREIGN KEY (sku_id) REFERENCES product_skus(id) ON DELETE CASCADE
  ) ${mysqlTableOptions}`,
  `CREATE TABLE IF NOT EXISTS orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(64) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','shipped','completed','cancelled')),
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
    receiver VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    province VARCHAR(100) NOT NULL DEFAULT '',
    city VARCHAR(100) NOT NULL DEFAULT '',
    district VARCHAR(100) NOT NULL DEFAULT '',
    detail TEXT NOT NULL,
    remark TEXT NOT NULL,
    paid_at DATETIME NULL,
    shipped_at DATETIME NULL,
    completed_at DATETIME NULL,
    cancelled_at DATETIME NULL,
    cancel_reason VARCHAR(500) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_orders_user (user_id),
    INDEX idx_orders_status (status),
    INDEX idx_orders_status_created (status, created_at),
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ${mysqlTableOptions}`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    sku_id BIGINT NOT NULL DEFAULT 0,
    sku_name VARCHAR(255) NOT NULL DEFAULT '',
    product_name VARCHAR(255) NOT NULL,
    product_image TEXT NOT NULL,
    price DECIMAL(12,2) NOT NULL CHECK(price >= 0),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order_items_order (order_id),
    INDEX idx_order_items_product_image (product_image(255)),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  ) ${mysqlTableOptions}`,
  `CREATE TABLE IF NOT EXISTS stock_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    sku_id BIGINT NOT NULL DEFAULT 0,
    sku_name VARCHAR(255) NOT NULL DEFAULT '',
    delta INTEGER NOT NULL,
    stock_after INTEGER NOT NULL,
    reason VARCHAR(20) NOT NULL CHECK(reason IN ('init','order','cancel','adjust')),
    ref VARCHAR(500) NOT NULL DEFAULT '',
    operator VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_logs_product (product_id)
  ) ${mysqlTableOptions}`,
]

export async function initializeSchema(db: DatabaseAdapter): Promise<void> {
  for (const statement of mysqlSchema) await db.exec(statement)
}
