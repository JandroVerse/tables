const API_URL = process.env.NODE_ENV === 'production' 
  ? '' 
  : 'http://localhost:5000';

// Use `${API_URL}/api/...` for your API calls 