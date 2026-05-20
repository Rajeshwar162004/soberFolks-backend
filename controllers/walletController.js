// walletController.js - Driver Wallet Management

const db = require('../db');
const {
  MIN_WITHDRAWAL_AMOUNT,
  MAX_WITHDRAWAL_AMOUNT
} = require('../config/constants');

/**
 * Get driver wallet balance and details
 * GET /api/wallet
 */
async function getWallet(req, res) {
  try {
    const driverId = req.user.id;

    // Get wallet details
    const walletResult = await db.query(
      `SELECT * FROM driver_wallets WHERE driver_id = $1`,
      [driverId]
    );

    if (walletResult.rows.length === 0) {
      // Create wallet if doesn't exist
      const newWallet = await db.query(
        `INSERT INTO driver_wallets (driver_id, balance, total_earnings, total_withdrawn, pending_withdrawal)
         VALUES ($1, 0, 0, 0, 0) RETURNING *`,
        [driverId]
      );
      
      return res.json({
        success: true,
        wallet: formatWalletResponse(newWallet.rows[0])
      });
    }

    res.json({
      success: true,
      wallet: formatWalletResponse(walletResult.rows[0])
    });

  } catch (error) {
    console.error('❌ Get wallet error:', error);
    res.status(500).json({ success: false, error: 'Failed to get wallet details' });
  }
}

/**
 * Format wallet response (convert paise to rupees)
 */
function formatWalletResponse(wallet) {
  return {
    id: wallet.id,
    balance: wallet.balance / 100,
    balancePaise: wallet.balance,
    totalEarnings: wallet.total_earnings / 100,
    totalWithdrawn: wallet.total_withdrawn / 100,
    pendingWithdrawal: wallet.pending_withdrawal / 100,
    availableBalance: (wallet.balance - wallet.pending_withdrawal) / 100,
    createdAt: wallet.created_at,
    updatedAt: wallet.updated_at
  };
}

/**
 * Get wallet transaction history
 * GET /api/wallet/transactions
 */
async function getTransactions(req, res) {
  try {
    const driverId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    // Get transactions
    const transactionsResult = await db.query(
      `SELECT wt.*, r.pickup_address, r.drop_address
       FROM wallet_transactions wt
       LEFT JOIN rides r ON wt.ride_id = r.id
       WHERE wt.driver_id = $1
       ORDER BY wt.created_at DESC
       LIMIT $2 OFFSET $3`,
      [driverId, limit, offset]
    );

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM wallet_transactions WHERE driver_id = $1`,
      [driverId]
    );

    const transactions = transactionsResult.rows.map(t => ({
      id: t.id,
      type: t.type,
      amount: t.amount / 100,
      amountPaise: t.amount,
      description: t.description,
      referenceType: t.reference_type,
      referenceId: t.reference_id,
      rideId: t.ride_id,
      balanceBefore: t.balance_before / 100,
      balanceAfter: t.balance_after / 100,
      pickup: t.pickup_address,
      drop: t.drop_address,
      createdAt: t.created_at
    }));

    res.json({
      success: true,
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get transactions error:', error);
    res.status(500).json({ success: false, error: 'Failed to get transactions' });
  }
}

/**
 * Create withdrawal request
 * POST /api/wallet/withdraw
 */
async function createWithdrawalRequest(req, res) {
  const client = await db.connect();
  
  try {
    const driverId = req.user.id;
    const { amount, upiId, bankAccountHolder, bankAccountNumber, bankIfscCode } = req.body;

    // Amount should be in rupees from frontend, convert to paise
    const amountPaise = Math.round(amount * 100);

    // Validate amount
    if (!amount || amountPaise < MIN_WITHDRAWAL_AMOUNT) {
      return res.status(400).json({ 
        success: false, 
        error: `Minimum withdrawal amount is ₹${MIN_WITHDRAWAL_AMOUNT / 100}` 
      });
    }

    if (amountPaise > MAX_WITHDRAWAL_AMOUNT) {
      return res.status(400).json({ 
        success: false, 
        error: `Maximum withdrawal amount is ₹${MAX_WITHDRAWAL_AMOUNT / 100}` 
      });
    }

    // Validate payment method - need at least UPI or bank details
    if (!upiId && !bankAccountNumber) {
      return res.status(400).json({ 
        success: false, 
        error: 'Please provide UPI ID or bank account details' 
      });
    }

    await client.query('BEGIN');

    // Get wallet with lock
    const walletResult = await client.query(
      `SELECT * FROM driver_wallets WHERE driver_id = $1 FOR UPDATE`,
      [driverId]
    );

    if (walletResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    const wallet = walletResult.rows[0];
    const availableBalance = wallet.balance - wallet.pending_withdrawal;

    // Check available balance
    if (amountPaise > availableBalance) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient balance. Available: ₹${availableBalance / 100}` 
      });
    }

    // Check for pending withdrawal requests
    const pendingCheck = await client.query(
      `SELECT COUNT(*) FROM withdrawal_requests 
       WHERE driver_id = $1 AND status = 'pending'`,
      [driverId]
    );

    if (parseInt(pendingCheck.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: 'You already have a pending withdrawal request' 
      });
    }

    // Create withdrawal request
    const withdrawalResult = await client.query(
      `INSERT INTO withdrawal_requests 
       (driver_id, wallet_id, amount, upi_id, bank_account_holder, bank_account_number, bank_ifsc_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING id`,
      [
        driverId,
        wallet.id,
        amountPaise,
        upiId || null,
        bankAccountHolder || null,
        bankAccountNumber || null,
        bankIfscCode || null
      ]
    );

    const withdrawalId = withdrawalResult.rows[0].id;

    // Update pending withdrawal in wallet
    await client.query(
      `UPDATE driver_wallets 
       SET pending_withdrawal = pending_withdrawal + $1, updated_at = NOW()
       WHERE id = $2`,
      [amountPaise, wallet.id]
    );

    // Create transaction record
    await client.query(
      `INSERT INTO wallet_transactions 
       (wallet_id, driver_id, type, amount, reference_type, reference_id, balance_before, balance_after, description)
       VALUES ($1, $2, 'withdrawal_request', $3, 'withdrawal', $4, $5, $5, $6)`,
      [
        wallet.id,
        driverId,
        amountPaise,
        withdrawalId,
        wallet.balance,
        `Withdrawal request #${withdrawalId} initiated`
      ]
    );

    await client.query('COMMIT');

    console.log(`💸 Withdrawal request created: ₹${amount} for driver ${driverId}`);

    res.json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      request: {
        id: withdrawalId,
        amount: amount,
        status: 'pending',
        estimatedProcessingTime: '2-3 business days'
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Create withdrawal error:', error);
    res.status(500).json({ success: false, error: 'Failed to create withdrawal request' });
  } finally {
    client.release();
  }
}

/**
 * Get withdrawal request history
 * GET /api/wallet/withdrawals
 */
async function getWithdrawals(req, res) {
  try {
    const driverId = req.user.id;
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM withdrawal_requests WHERE driver_id = $1`;
    const params = [driverId];

    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const withdrawalsResult = await db.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM withdrawal_requests WHERE driver_id = $1`;
    const countParams = [driverId];
    if (status) {
      countQuery += ` AND status = $2`;
      countParams.push(status);
    }
    const countResult = await db.query(countQuery, countParams);

    const withdrawals = withdrawalsResult.rows.map(w => ({
      id: w.id,
      amount: w.amount / 100,
      status: w.status,
      upiId: w.upi_id,
      bankAccountNumber: w.bank_account_number ? `****${w.bank_account_number.slice(-4)}` : null,
      adminNotes: w.admin_notes,
      createdAt: w.created_at,
      processedAt: w.processed_at
    }));

    res.json({
      success: true,
      withdrawals,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get withdrawals error:', error);
    res.status(500).json({ success: false, error: 'Failed to get withdrawals' });
  }
}

/**
 * Cancel pending withdrawal request
 * DELETE /api/wallet/withdraw/:id
 */
async function cancelWithdrawal(req, res) {
  const client = await db.connect();
  
  try {
    const driverId = req.user.id;
    const { id } = req.params;

    await client.query('BEGIN');

    // Get withdrawal request
    const withdrawalResult = await client.query(
      `SELECT * FROM withdrawal_requests WHERE id = $1 AND driver_id = $2 FOR UPDATE`,
      [id, driverId]
    );

    if (withdrawalResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Withdrawal request not found' });
    }

    const withdrawal = withdrawalResult.rows[0];

    if (withdrawal.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: 'Only pending requests can be cancelled' 
      });
    }

    // Update withdrawal status
    await client.query(
      `UPDATE withdrawal_requests SET status = 'rejected', admin_notes = 'Cancelled by user', updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    // Restore pending amount in wallet
    await client.query(
      `UPDATE driver_wallets 
       SET pending_withdrawal = pending_withdrawal - $1, updated_at = NOW()
       WHERE id = $2`,
      [withdrawal.amount, withdrawal.wallet_id]
    );

    // Create transaction record
    const walletResult = await client.query(
      `SELECT balance FROM driver_wallets WHERE id = $1`,
      [withdrawal.wallet_id]
    );

    await client.query(
      `INSERT INTO wallet_transactions 
       (wallet_id, driver_id, type, amount, reference_type, reference_id, balance_before, balance_after, description)
       VALUES ($1, $2, 'withdrawal_rejected', $3, 'withdrawal', $4, $5, $5, $6)`,
      [
        withdrawal.wallet_id,
        driverId,
        withdrawal.amount,
        id,
        walletResult.rows[0].balance,
        `Withdrawal request #${id} cancelled`
      ]
    );

    await client.query('COMMIT');

    console.log(`🚫 Withdrawal request ${id} cancelled by driver ${driverId}`);

    res.json({
      success: true,
      message: 'Withdrawal request cancelled successfully'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Cancel withdrawal error:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel withdrawal' });
  } finally {
    client.release();
  }
}

/**
 * Get wallet summary (for dashboard)
 * GET /api/wallet/summary
 */
async function getWalletSummary(req, res) {
  try {
    const driverId = req.user.id;

    // Get wallet
    const walletResult = await db.query(
      `SELECT * FROM driver_wallets WHERE driver_id = $1`,
      [driverId]
    );

    if (walletResult.rows.length === 0) {
      return res.json({
        success: true,
        summary: {
          balance: 0,
          todayEarnings: 0,
          weekEarnings: 0,
          monthEarnings: 0,
          totalRides: 0
        }
      });
    }

    const wallet = walletResult.rows[0];

    // Get earnings breakdown
    const earningsResult = await db.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE THEN amount ELSE 0 END), 0) as today,
         COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN amount ELSE 0 END), 0) as week,
         COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN amount ELSE 0 END), 0) as month,
         COUNT(DISTINCT ride_id) as total_rides
       FROM wallet_transactions 
       WHERE driver_id = $1 AND type = 'credit'`,
      [driverId]
    );

    const earnings = earningsResult.rows[0];

    res.json({
      success: true,
      summary: {
        balance: wallet.balance / 100,
        availableBalance: (wallet.balance - wallet.pending_withdrawal) / 100,
        pendingWithdrawal: wallet.pending_withdrawal / 100,
        todayEarnings: parseInt(earnings.today) / 100,
        weekEarnings: parseInt(earnings.week) / 100,
        monthEarnings: parseInt(earnings.month) / 100,
        totalRides: parseInt(earnings.total_rides)
      }
    });

  } catch (error) {
    console.error('❌ Get wallet summary error:', error);
    res.status(500).json({ success: false, error: 'Failed to get wallet summary' });
  }
}

module.exports = {
  getWallet,
  getTransactions,
  createWithdrawalRequest,
  getWithdrawals,
  cancelWithdrawal,
  getWalletSummary
};
