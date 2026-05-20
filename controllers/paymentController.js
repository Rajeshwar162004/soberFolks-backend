// paymentController.js - Razorpay Payment Integration

const Razorpay = require('razorpay');
const crypto = require('crypto');
const db = require('../db');
const {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  PLATFORM_COMMISSION_PERCENT,
  DRIVER_EARNING_PERCENT,
  BASE_FARE,
  PER_KM_RATE
} = require('../config/constants');

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET
});

/**
 * Calculate fare breakdown
 */
function calculateFareBreakdown(fareInRupees) {
  const totalPaise = Math.round(fareInRupees * 100);
  const platformFeePaise = Math.round(totalPaise * PLATFORM_COMMISSION_PERCENT / 100);
  const driverAmountPaise = totalPaise - platformFeePaise;
  
  return {
    totalPaise,
    platformFeePaise,
    driverAmountPaise,
    totalRupees: fareInRupees,
    platformFeeRupees: platformFeePaise / 100,
    driverAmountRupees: driverAmountPaise / 100
  };
}

/**
 * Create Razorpay Order
 * POST /api/payments/create-order
 */
async function createOrder(req, res) {
  const client = await db.connect();
  
  try {
    const { rideId } = req.body;
    const consumerId = req.user.id;

    if (!rideId) {
      return res.status(400).json({ success: false, error: 'Ride ID is required' });
    }

    // Get ride details
    const rideResult = await client.query(
      `SELECT r.id, r.consumer_id, r.driver_id, r.fare, r.status, r.payment_status,
              r.distance_km, r.pickup_address, r.drop_address,
              d.full_name as driver_name, d.phone as driver_phone
       FROM rides r
       LEFT JOIN drivers d ON r.driver_id = d.id
       WHERE r.id = $1`,
      [rideId]
    );

    if (rideResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Ride not found' });
    }

    const ride = rideResult.rows[0];

    // Validate ownership
    if (ride.consumer_id !== consumerId) {
      return res.status(403).json({ success: false, error: 'Unauthorized access to this ride' });
    }

    // Check ride status - must be completed
    if (ride.status !== 'completed') {
      return res.status(400).json({ 
        success: false, 
        error: 'Payment can only be made after ride is completed' 
      });
    }

    // Check if already paid
    if (ride.payment_status === 'paid') {
      return res.status(400).json({ 
        success: false, 
        error: 'Payment already completed for this ride' 
      });
    }

    // Check for existing pending/processing payment
    const existingPayment = await client.query(
      `SELECT id, razorpay_order_id, status FROM payments 
       WHERE ride_id = $1 AND status IN ('pending', 'processing')`,
      [rideId]
    );

    if (existingPayment.rows.length > 0) {
      const existing = existingPayment.rows[0];
      // Return existing order if still valid
      return res.json({
        success: true,
        message: 'Existing order found',
        order: {
          id: existing.razorpay_order_id,
          amount: Math.round(ride.fare * 100),
          currency: 'INR'
        },
        rideDetails: {
          fare: ride.fare,
          distance: `${ride.distance_km} km`,
          pickup: ride.pickup_address,
          drop: ride.drop_address,
          driverName: ride.driver_name
        }
      });
    }

    // Calculate fare breakdown
    const fareBreakdown = calculateFareBreakdown(parseFloat(ride.fare));

    // Create Razorpay order
    const orderOptions = {
      amount: fareBreakdown.totalPaise,
      currency: 'INR',
      receipt: `ride_${rideId}_${Date.now()}`,
      notes: {
        rideId: rideId.toString(),
        consumerId: consumerId.toString(),
        driverId: ride.driver_id.toString()
      }
    };

    const razorpayOrder = await razorpay.orders.create(orderOptions);

    // Store payment record in database
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO payments 
       (ride_id, consumer_id, driver_id, razorpay_order_id, total_amount, platform_fee, driver_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
      [
        rideId,
        consumerId,
        ride.driver_id,
        razorpayOrder.id,
        fareBreakdown.totalPaise,
        fareBreakdown.platformFeePaise,
        fareBreakdown.driverAmountPaise
      ]
    );

    await client.query('COMMIT');

    console.log(`✅ Razorpay order created: ${razorpayOrder.id} for ride ${rideId}`);

    res.json({
      success: true,
      order: {
        id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency
      },
      key: RAZORPAY_KEY_ID,
      rideDetails: {
        fare: ride.fare,
        distance: `${ride.distance_km} km`,
        pickup: ride.pickup_address,
        drop: ride.drop_address,
        driverName: ride.driver_name
      },
      fareBreakdown: {
        total: fareBreakdown.totalRupees,
        platformFee: fareBreakdown.platformFeeRupees,
        driverAmount: fareBreakdown.driverAmountRupees
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Create order error:', error);
    res.status(500).json({ success: false, error: 'Failed to create payment order' });
  } finally {
    client.release();
  }
}

/**
 * Verify Razorpay Payment Signature
 * POST /api/payments/verify
 */
async function verifyPayment(req, res) {
  const client = await db.connect();
  
  try {
    const { rideId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const consumerId = req.user.id;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing payment verification parameters' 
      });
    }

    // Verify signature
    const generatedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      console.error('❌ Payment signature verification failed');
      
      // Update payment status to failed
      await client.query(
        `UPDATE payments SET status = 'failed', failure_reason = 'Signature verification failed', updated_at = NOW()
         WHERE razorpay_order_id = $1`,
        [razorpay_order_id]
      );
      
      return res.status(400).json({ 
        success: false, 
        error: 'Payment verification failed',
        retryAllowed: true
      });
    }

    await client.query('BEGIN');

    // Get payment record
    const paymentResult = await client.query(
      `SELECT p.*, r.driver_id 
       FROM payments p
       JOIN rides r ON p.ride_id = r.id
       WHERE p.razorpay_order_id = $1`,
      [razorpay_order_id]
    );

    if (paymentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Payment record not found' });
    }

    const payment = paymentResult.rows[0];

    // Verify ownership
    if (payment.consumer_id !== consumerId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Check if already processed
    if (payment.status === 'success') {
      await creditDriverWallet(
        client,
        payment.driver_id,
        payment.driver_amount,
        payment.id,
        payment.ride_id
      );

      await client.query('COMMIT');
      return res.json({ 
        success: true, 
        message: 'Payment already verified',
        payment: {
          id: payment.id,
          amount: payment.total_amount / 100,
          driverAmount: payment.driver_amount / 100,
          platformFee: payment.platform_fee / 100
        }
      });
    }

    // Get payment details from Razorpay for method info
    let paymentMethod = 'unknown';
    try {
      const razorpayPayment = await razorpay.payments.fetch(razorpay_payment_id);
      paymentMethod = razorpayPayment.method || 'unknown';
    } catch (err) {
      console.warn('Could not fetch payment method:', err.message);
    }

    // Update payment record
    await client.query(
      `UPDATE payments 
       SET razorpay_payment_id = $1, razorpay_signature = $2, status = 'success', 
           payment_method = $3, completed_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [razorpay_payment_id, razorpay_signature, paymentMethod, payment.id]
    );

    // Update ride payment status
    await client.query(
      `UPDATE rides SET payment_status = 'paid' WHERE id = $1`,
      [payment.ride_id]
    );

    // Credit driver wallet
    await creditDriverWallet(
      client,
      payment.driver_id,
      payment.driver_amount,
      payment.id,
      payment.ride_id
    );

    await client.query('COMMIT');

    console.log(`✅ Payment verified successfully: ${razorpay_payment_id}`);

    res.json({
      success: true,
      message: 'Payment verified successfully',
      payment: {
        id: payment.id,
        amount: payment.total_amount / 100,
        driverAmount: payment.driver_amount / 100,
        platformFee: payment.platform_fee / 100,
        method: paymentMethod
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Payment verification error:', error);
    res.status(500).json({ success: false, error: 'Payment verification failed' });
  } finally {
    client.release();
  }
}

/**
 * Credit driver wallet after successful payment
 */
async function creditDriverWallet(client, driverId, amountPaise, paymentId, rideId) {
  const existingCredit = await client.query(
    `SELECT id FROM wallet_transactions
     WHERE reference_type = 'payment' AND reference_id = $1 AND type = 'credit'
     LIMIT 1`,
    [paymentId]
  );

  if (existingCredit.rows.length > 0) {
    console.log(`Wallet credit already exists for payment ${paymentId}; skipping duplicate credit`);
    return;
  }

  // Check if driver has a wallet, create if not
  let walletResult = await client.query(
    'SELECT id, balance FROM driver_wallets WHERE driver_id = $1 FOR UPDATE',
    [driverId]
  );

  let walletId, currentBalance;

  if (walletResult.rows.length === 0) {
    // Create new wallet
    const newWallet = await client.query(
      `INSERT INTO driver_wallets (driver_id, balance, total_earnings, total_withdrawn, pending_withdrawal)
       VALUES ($1, 0, 0, 0, 0) RETURNING id, balance`,
      [driverId]
    );
    walletId = newWallet.rows[0].id;
    currentBalance = 0;
  } else {
    walletId = walletResult.rows[0].id;
    currentBalance = walletResult.rows[0].balance;
  }

  const newBalance = currentBalance + amountPaise;

  // Update wallet balance
  await client.query(
    `UPDATE driver_wallets 
     SET balance = $1, total_earnings = total_earnings + $2, updated_at = NOW()
     WHERE id = $3`,
    [newBalance, amountPaise, walletId]
  );

  // Create transaction record
  await client.query(
    `INSERT INTO wallet_transactions 
     (wallet_id, driver_id, type, amount, reference_type, reference_id, ride_id, balance_before, balance_after, description)
     VALUES ($1, $2, 'credit', $3, 'payment', $4, $5, $6, $7, $8)`,
    [
      walletId,
      driverId,
      amountPaise,
      paymentId,
      rideId,
      currentBalance,
      newBalance,
      `Earnings from ride #${rideId}`
    ]
  );

  console.log(`💰 Credited ₹${amountPaise / 100} to driver ${driverId}'s wallet`);
}

/**
 * Get payment details for a ride
 * GET /api/payments/ride/:rideId
 */
async function getPaymentDetails(req, res) {
  try {
    const { rideId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const paymentResult = await db.query(
      `SELECT p.*, r.fare, r.distance_km, r.pickup_address, r.drop_address, r.status as ride_status,
              c.full_name as consumer_name, d.full_name as driver_name
       FROM payments p
       JOIN rides r ON p.ride_id = r.id
       LEFT JOIN consumers c ON p.consumer_id = c.id
       LEFT JOIN drivers d ON p.driver_id = d.id
       WHERE p.ride_id = $1`,
      [rideId]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Payment not found for this ride' });
    }

    const payment = paymentResult.rows[0];

    // Verify authorization
    if (userRole === 'consumer' && payment.consumer_id !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    if (userRole === 'driver' && payment.driver_id !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    res.json({
      success: true,
      payment: {
        id: payment.id,
        status: payment.status,
        totalAmount: payment.total_amount / 100,
        platformFee: payment.platform_fee / 100,
        driverAmount: payment.driver_amount / 100,
        paymentMethod: payment.payment_method,
        razorpayOrderId: payment.razorpay_order_id,
        razorpayPaymentId: payment.razorpay_payment_id,
        createdAt: payment.created_at,
        completedAt: payment.completed_at
      },
      ride: {
        fare: payment.fare,
        distance: payment.distance_km,
        pickup: payment.pickup_address,
        drop: payment.drop_address,
        status: payment.ride_status,
        consumerName: payment.consumer_name,
        driverName: payment.driver_name
      }
    });

  } catch (error) {
    console.error('❌ Get payment details error:', error);
    res.status(500).json({ success: false, error: 'Failed to get payment details' });
  }
}

/**
 * Retry failed payment
 * POST /api/payments/retry/:rideId
 */
async function retryPayment(req, res) {
  const client = await db.connect();
  
  try {
    const { rideId } = req.params;
    const consumerId = req.user.id;

    // Check retry count
    const retryCheck = await client.query(
      `SELECT COUNT(*) as count FROM payments 
       WHERE ride_id = $1 AND status = 'failed'`,
      [rideId]
    );

    if (parseInt(retryCheck.rows[0].count) >= 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Maximum payment attempts exceeded. Please contact support.' 
      });
    }

    // Delete the failed payment record
    await client.query(
      `DELETE FROM payments WHERE ride_id = $1 AND status IN ('failed', 'pending')`,
      [rideId]
    );

    // Create new order using the existing createOrder logic
    req.body.rideId = parseInt(rideId);
    return createOrder(req, res);

  } catch (error) {
    console.error('❌ Retry payment error:', error);
    res.status(500).json({ success: false, error: 'Failed to retry payment' });
  } finally {
    client.release();
  }
}

/**
 * Handle payment failure from client
 * POST /api/payments/failed
 */
async function handlePaymentFailure(req, res) {
  try {
    const { razorpay_order_id, error_code, error_description } = req.body;

    if (!razorpay_order_id) {
      return res.status(400).json({ success: false, error: 'Order ID required' });
    }

    await db.query(
      `UPDATE payments 
       SET status = 'failed', 
           failure_reason = $1, 
           retry_count = retry_count + 1,
           updated_at = NOW()
       WHERE razorpay_order_id = $2`,
      [`${error_code}: ${error_description}`, razorpay_order_id]
    );

    console.log(`⚠️ Payment failed for order ${razorpay_order_id}: ${error_description}`);

    res.json({ success: true, message: 'Payment failure recorded' });

  } catch (error) {
    console.error('❌ Handle payment failure error:', error);
    res.status(500).json({ success: false, error: 'Failed to record payment failure' });
  }
}

module.exports = {
  createOrder,
  verifyPayment,
  getPaymentDetails,
  retryPayment,
  handlePaymentFailure
};
