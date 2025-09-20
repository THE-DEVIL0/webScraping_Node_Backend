const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true
  },
  planName: {
    type: String,
    required: true
  },
  planPrice: {
    type: Number,
    required: true
  },
  stripePaymentIntentId: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'expired'],
    default: 'active'
  },
  billingAddress: {
    street: String,
    city: String,
    zipCode: String,
    country: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Subscription', subscriptionSchema);