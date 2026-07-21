import React from 'react';
import '../styles/CategoryFilter.css';

function CategoryFilter({ accounts, selected, onSelect }) {
  const categories = [
    { id: 'All', name: 'All Accounts', emoji: '📋' },
    { id: 'personal', name: 'Personal', emoji: '👤' },
    { id: 'work', name: 'Work', emoji: '💼' },
    { id: 'gaming', name: 'Gaming', emoji: '🎮' },
    { id: 'shopping', name: 'Shopping', emoji: '🛒' },
    { id: 'banking', name: 'Banking', emoji: '🏦' },
    { id: 'social', name: 'Social Media', emoji: '📱' },
    { id: 'other', name: 'Other', emoji: '📌' },
  ];

  const getCategoryCount = (categoryId) => {
    if (categoryId === 'All') return accounts.length;
    return accounts.filter(acc => acc.category === categoryId).length;
  };

  return (
    <div className="category-filter">
      <h3>📂 Categories</h3>
      <div className="categories-list">
        {categories.map((cat) => {
          const count = getCategoryCount(cat.id);
          return (
            <button
              key={cat.id}
              className={`category-item ${selected === cat.id ? 'active' : ''}`}
              onClick={() => onSelect(cat.id)}
            >
              <span className="emoji">{cat.emoji}</span>
              <span className="name">{cat.name}</span>
              <span className="count">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default CategoryFilter;