import React, { useState } from 'react';
import '../styles/AccountForm.css';

function AccountForm({ account, onSubmit, onCancel }) {
  const [formData, setFormData] = useState(
    account || {
      category: 'personal',
      platform: '',
      username: '',
      email: '',
      password: '',
      notes: '',
    }
  );
  const [passwordStrength, setPasswordStrength] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    
    if (name === 'password') {
      validatePasswordStrength(value);
    }
  };

  const validatePasswordStrength = async (password) => {
    if (password) {
      try {
        const result = await window.electron.validatePasswordStrength(password);
        setPasswordStrength(result.strength);
      } catch (err) {
        console.error('Error validating password:', err);
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.platform || !formData.username || !formData.password) {
      alert('Please fill in all required fields');
      return;
    }
    onSubmit(formData);
  };

  const generatePassword = () => {
    const length = 16;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFormData((prev) => ({ ...prev, password }));
    validatePasswordStrength(password);
  };

  const getStrengthColor = (strength) => {
    switch (strength) {
      case 'Very Strong':
      case 'Strong':
        return '#10b981';
      case 'Good':
        return '#f59e0b';
      case 'Fair':
      case 'Weak':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  return (
    <div className="account-form-container">
      <h3>{account ? 'Edit Account' : 'Add New Account'}</h3>
      <form onSubmit={handleSubmit} className="account-form">
        <div className="form-group">
          <label>Category *</label>
          <select name="category" value={formData.category} onChange={handleChange} required>
            <option value="personal">👤 Personal</option>
            <option value="work">💼 Work</option>
            <option value="gaming">🎮 Gaming</option>
            <option value="shopping">🛒 Shopping</option>
            <option value="banking">🏦 Banking</option>
            <option value="social">📱 Social Media</option>
            <option value="other">📌 Other</option>
          </select>
        </div>

        <div className="form-group">
          <label>Platform/Service *</label>
          <input
            type="text"
            name="platform"
            value={formData.platform}
            onChange={handleChange}
            placeholder="e.g., Gmail, Discord, GitHub"
            required
          />
        </div>

        <div className="form-group">
          <label>Username *</label>
          <input
            type="text"
            name="username"
            value={formData.username}
            onChange={handleChange}
            placeholder="Your username"
            required
          />
        </div>

        <div className="form-group">
          <label>Email</label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="Associated email (optional)"
          />
        </div>

        <div className="form-group">
          <label>Password *</label>
          <div className="password-input-group">
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Enter secure password"
              required
            />
            <button type="button" onClick={generatePassword} className="btn-generate">
              Generate
            </button>
          </div>
          {passwordStrength && (
            <div className="strength-indicator">
              <div 
                className="strength-bar" 
                style={{ backgroundColor: getStrengthColor(passwordStrength) }}
              ></div>
              <span style={{ color: getStrengthColor(passwordStrength) }}>{passwordStrength}</span>
            </div>
          )}
        </div>

        <div className="form-group">
          <label>Notes</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            placeholder="Add any notes about this account"
            rows="3"
          ></textarea>
        </div>

        <div className="form-actions">
          <button type="button" onClick={onCancel} className="btn btn-outline">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {account ? 'Update Account' : 'Add Account'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AccountForm;