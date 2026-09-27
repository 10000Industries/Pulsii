'use strict';
const form = document.getElementById('login-form');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  const error = document.getElementById('error');
  button.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to sign in.');
    window.location.replace('/admin');
  } catch (problem) { error.textContent = problem.message || 'Unable to sign in.'; }
  finally { button.disabled = false; }
});
