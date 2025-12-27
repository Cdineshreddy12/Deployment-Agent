import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5002/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Only logout on actual authentication failures, not business logic errors
    if (error.response?.status === 401) {
      const errorCode = error.response?.data?.error?.code;
      const errorMessage = (error.response?.data?.error?.message || '').toLowerCase();
      const requestUrl = error.config?.url || '';
      
      // Don't logout for these business logic errors:
      // - GitHub-related errors (GITHUB_TOKEN_REQUIRED, GITHUB_TOKEN_INVALID, etc.)
      // - Repository access errors
      // - Any error from /github/* endpoints (these are GitHub API errors, not auth errors)
      const isBusinessLogicError = 
        errorCode?.includes('GITHUB') ||
        errorCode?.includes('REPOSITORY') ||
        requestUrl.includes('/github/') ||
        requestUrl.includes('/github/analyze') ||
        errorMessage.includes('github token') ||
        errorMessage.includes('repository') ||
        errorMessage.includes('access denied') ||
        errorMessage.includes('not found');
      
      // Only logout if it's an actual user authentication failure
      // Check for specific auth error codes or messages
      // IMPORTANT: Only logout if it's clearly an auth error, not a business logic error
      const isAuthFailure = 
        !isBusinessLogicError && (
          errorCode === 'UNAUTHORIZED' ||
          errorCode === 'INVALID_TOKEN' ||
          errorCode === 'TOKEN_EXPIRED' ||
          errorCode === 'INVALID_CREDENTIALS' ||
          (errorMessage.includes('authentication') && !errorMessage.includes('github')) ||
          (errorMessage.includes('unauthorized') && !errorMessage.includes('repository')) ||
          errorMessage.includes('token expired') ||
          (errorMessage.includes('invalid token') && !errorMessage.includes('github')) ||
          errorMessage.includes('please login') ||
          errorMessage.includes('please log in')
        );
      
      // Only logout on clear authentication failures
      // Never logout for GitHub/repository related errors
      if (isAuthFailure && !isBusinessLogicError) {
        console.warn('Authentication failure detected, logging out user');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // Use a small delay to prevent race conditions
        setTimeout(() => {
          window.location.href = '/login';
        }, 100);
      } else if (isBusinessLogicError) {
        // Log but don't logout for business logic errors
        console.log('Business logic error (not logging out):', errorCode, errorMessage);
      }
    }
    return Promise.reject(error);
  }
);

export default api;
