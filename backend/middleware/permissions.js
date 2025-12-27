const logger = require('../utils/logger');

// Role definitions with permissions
const roles = {
  admin: {
    permissions: ['*'], // All permissions
    description: 'Platform administrators'
  },
  developer: {
    permissions: [
      'deployments.create',
      'deployments.read',
      'deployments.update:own',
      'deployments.delete:own',
      'sandbox.create',
      'sandbox.read',
      'chat.use',
      'costs.read'
    ],
    description: 'Regular developers'
  },
  tech_lead: {
    permissions: [
      'deployments.create',
      'deployments.read',
      'deployments.update:own',
      'deployments.update:team',
      'deployments.delete:own',
      'deployments.delete:team',
      'deployments.approve',
      'deployments.reject',
      'deployments.rollback',
      'sandbox.create',
      'sandbox.read',
      'chat.use',
      'costs.read',
      'costs.manage',
      'users.read'
    ],
    description: 'Team leads with approval rights'
  },
  viewer: {
    permissions: [
      'deployments.read',
      'costs.read',
      'dashboards.read'
    ],
    description: 'Read-only access for stakeholders'
  },
  devops: {
    permissions: [
      '*:deployments',
      '*:sandbox',
      '*:terraform',
      'state.manage',
      'infrastructure.manage'
    ],
    description: 'DevOps team with infrastructure access'
  }
};

// Check if user has permission
const checkPermission = (user, permission, resource = null) => {
  if (!user || !user.role) {
    return false;
  }
  
  const role = roles[user.role];
  if (!role) {
    return false;
  }
  
  // Admin has all permissions
  if (role.permissions.includes('*')) {
    return true;
  }
  
  // Check exact permission
  if (role.permissions.includes(permission)) {
    return true;
  }
  
  // Check wildcard permissions (e.g., '*:deployments')
  const wildcardPerms = role.permissions.filter(p => p.includes('*'));
  for (const wildcard of wildcardPerms) {
    const [prefix, resourceType] = wildcard.split(':');
    if (prefix === '*' && permission.includes(`:${resourceType}`)) {
      return true;
    }
  }
  
  // Check scoped permissions (e.g., 'deployments.update:own')
  const [action, scope] = permission.split(':');
  if (scope === 'own' && resource) {
    // Check if user owns the resource
    if (resource.userId && resource.userId.toString() === user._id.toString()) {
      const scopedPermission = `${action}:own`;
      if (role.permissions.includes(scopedPermission)) {
        return true;
      }
    }
  }
  
  if (scope === 'team' && resource) {
    // Check if user is in the same team
    if (resource.team && resource.team === user.team) {
      const scopedPermission = `${action}:team`;
      if (role.permissions.includes(scopedPermission)) {
        return true;
      }
    }
  }
  
  return false;
};

// Middleware to require specific permission
const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }
        });
      }
      
      // Get resource if needed (for scoped permissions)
      let resource = null;
      if (permission.includes(':own') || permission.includes(':team')) {
        // Try to get resource from params or body
        const resourceId = req.params.id || req.params.deploymentId || req.body.deploymentId;
        if (resourceId) {
          // This would need to be implemented based on resource type
          // For now, we'll pass the request object
          resource = req;
        }
      }
      
      const hasPermission = checkPermission(user, permission, resource);
      
      if (!hasPermission) {
        logger.warn('Permission denied', {
          userId: user._id,
          email: user.email,
          permission,
          role: user.role
        });
        
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Required permission: ${permission}`
          }
        });
      }
      
      next();
    } catch (error) {
      logger.error('Permission check error:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Permission check failed'
        }
      });
    }
  };
};

// Middleware to require specific role
const requireRole = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }
        });
      }
      
      if (!allowedRoles.includes(user.role)) {
        logger.warn('Role denied', {
          userId: user._id,
          email: user.email,
          role: user.role,
          requiredRoles: allowedRoles
        });
        
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Required role: ${allowedRoles.join(' or ')}`
          }
        });
      }
      
      next();
    } catch (error) {
      logger.error('Role check error:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Role check failed'
        }
      });
    }
  };
};

module.exports = {
  roles,
  checkPermission,
  requirePermission,
  requireRole
};

