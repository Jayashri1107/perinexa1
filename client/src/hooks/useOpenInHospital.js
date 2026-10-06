// For the super admin: open one hospital's workspace on a given page (e.g. its Billing).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export function useOpenInHospital() {
  const { switchHospital } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const open = async (hospitalId, path) => {
    setError('');
    try {
      await switchHospital(hospitalId);
      navigate(path);
    } catch (err) {
      setError(err.message);
    }
  };
  return { open, error };
}
