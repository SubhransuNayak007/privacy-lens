const fs = require('fs');
const path = require('path');

const map = {
  'surface-bg': 'slate-50',
  'surface-card': 'white',
  'brand-primary': 'indigo-600',
  'brand-primary-hover': 'indigo-700',
  'text-primary': 'slate-900',
  'text-secondary': 'slate-600',
  'text-tertiary': 'slate-400',
  'border-subtle': 'slate-100',
  'border-default': 'slate-200',
  'success': 'emerald-500',
  'warning': 'amber-500',
  'danger': 'rose-500'
};

const walk = dir => {
  fs.readdirSync(dir).forEach(file => {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      walk(full);
    } else if (full.endsWith('.jsx')) {
      let c = fs.readFileSync(full, 'utf8');
      let changed = false;
      
      Object.entries(map).forEach(([k, v]) => {
        // Find things like text-[var(--color-text-primary)] or bg-[var(--color-surface-bg)]
        // Using string split & join to be safe from regex escaping
        const searchStr = `-[var(--color-${k})]`;
        if (c.includes(searchStr)) {
          c = c.split(searchStr).join(`-${v}`);
          changed = true;
        }
      });

      if (changed) {
        fs.writeFileSync(full, c);
        console.log('Fixed ' + full);
      }
    }
  });
};

walk('src');
