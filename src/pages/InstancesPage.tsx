import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function InstancesPage() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/library', { replace: true }); }, [navigate]);
  return null;
}
