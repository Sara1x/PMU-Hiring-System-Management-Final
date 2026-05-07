import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function FinalDecisions() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/dean/chair-recommendations', { replace: true }); }, [navigate]);
  return null;
}
