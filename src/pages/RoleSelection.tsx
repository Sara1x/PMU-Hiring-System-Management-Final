import { Users, Briefcase, User, ClipboardList } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function RoleSelection() {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      backgroundColor: '#002147',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    }}>
      
      {/* Logo with shadow */}
      <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
        <img
          src="/pmu-logo.png"
          alt="PMU Logo"
          style={{ 
            width: '96px', 
            height: '96px', 
            objectFit: 'contain',
            position: 'relative',
            zIndex: 2
          }}
        />
        <div style={{
          position: 'absolute',
          bottom: '-8px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '80px',
          height: '12px',
          background: 'rgba(0, 0, 0, 0.3)',
          borderRadius: '50%',
          filter: 'blur(8px)',
          zIndex: 1
        }}></div>
      </div>

      {/* Title */}
      <h1 style={{
        color: 'white',
        fontSize: '2.25rem',
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: '0.5rem',
        fontFamily: 'inherit'
      }}>
        Prince Mohammad Bin Fahad University
      </h1>

      <h2 style={{
        color: 'white',
        fontSize: '1.875rem',
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: '3rem',
        fontFamily: 'inherit'
      }}>
        Academic Hiring Management System
      </h2>

      {/* Cards Container */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '2rem',
        width: '100%',
        maxWidth: '56rem',
        marginBottom: '3rem'
      }}>
        
        {/* Dean Card */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '1rem',
          height: '11rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          cursor: 'pointer',
          transition: 'transform 0.2s'
        }}
        onClick={() => navigate('/login/Dean')}
        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          <Users style={{ width: '3.5rem', height: '3.5rem', color: '#002147', strokeWidth: 2, marginBottom: '0.75rem' }} />
          <span style={{ color: '#002147', fontSize: '1.25rem', fontWeight: '600', fontFamily: 'inherit' }}>Dean</span>
        </div>

        {/* HR Manager Card */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '1rem',
          height: '11rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          cursor: 'pointer',
          transition: 'transform 0.2s'
        }}
        onClick={() => navigate('/login/HR Manager')}
        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          <Briefcase style={{ width: '3.5rem', height: '3.5rem', color: '#002147', strokeWidth: 2, marginBottom: '0.75rem' }} />
          <span style={{ color: '#002147', fontSize: '1.25rem', fontWeight: '600', fontFamily: 'inherit' }}>HR Manager</span>
        </div>

        {/* Department Chair Card */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '1rem',
          height: '11rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          cursor: 'pointer',
          transition: 'transform 0.2s'
        }}
        onClick={() => navigate('/login/Department Chair')}
        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          <User style={{ width: '3.5rem', height: '3.5rem', color: '#002147', strokeWidth: 2, marginBottom: '0.75rem' }} />
          <span style={{ color: '#002147', fontSize: '1.25rem', fontWeight: '600', fontFamily: 'inherit' }}>Department Chair</span>
        </div>

        {/* Interviewer Card */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '1rem',
          height: '11rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          cursor: 'pointer',
          transition: 'transform 0.2s'
        }}
        onClick={() => navigate('/login/Interviewer')}
        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          <ClipboardList style={{ width: '3.5rem', height: '3.5rem', color: '#002147', strokeWidth: 2, marginBottom: '0.75rem' }} />
          <span style={{ color: '#002147', fontSize: '1.25rem', fontWeight: '600', fontFamily: 'inherit' }}>Interviewer</span>
        </div>

      </div>

      <p style={{ color: 'white', fontSize: '1rem' }}>
        Select your role to continue
      </p>
    </div>
  );
}