import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';

const client = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
});

// Attach JWT token to every request
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('noc_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear token
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('noc_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default client;
