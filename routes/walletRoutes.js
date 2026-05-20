// walletRoutes.js - Driver Wallet API Routes

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const walletController = require('../controllers/walletController');

/**
 * Middleware to ensure only drivers can access wallet routes
 */
const driverOnly = (req, res, next) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ 
      success: false, 
      error: 'Only drivers can access wallet features' 
    });
  }
  next();
};

/**
 * @route   GET /api/wallet
 * @desc    Get driver wallet balance and details
 * @access  Driver only
 */
router.get('/', authenticateToken, driverOnly, walletController.getWallet);

/**
 * @route   GET /api/wallet/summary
 * @desc    Get wallet summary with earnings breakdown
 * @access  Driver only
 */
router.get('/summary', authenticateToken, driverOnly, walletController.getWalletSummary);

/**
 * @route   GET /api/wallet/transactions
 * @desc    Get wallet transaction history
 * @access  Driver only
 * @query   page, limit
 */
router.get('/transactions', authenticateToken, driverOnly, walletController.getTransactions);

/**
 * @route   POST /api/wallet/withdraw
 * @desc    Create withdrawal request
 * @access  Driver only
 * @body    { amount, upiId?, bankAccountHolder?, bankAccountNumber?, bankIfscCode? }
 */
router.post('/withdraw', authenticateToken, driverOnly, walletController.createWithdrawalRequest);

/**
 * @route   GET /api/wallet/withdrawals
 * @desc    Get withdrawal request history
 * @access  Driver only
 * @query   page, limit, status
 */
router.get('/withdrawals', authenticateToken, driverOnly, walletController.getWithdrawals);

/**
 * @route   DELETE /api/wallet/withdraw/:id
 * @desc    Cancel pending withdrawal request
 * @access  Driver only
 */
router.delete('/withdraw/:id', authenticateToken, driverOnly, walletController.cancelWithdrawal);

module.exports = router;
