import type { UserRole } from '../types/userRole';

interface Props {
  currentPage: string;
  navigate: (page: string) => void;
  logout: () => void;
  userRole: UserRole;
}

export function Sidebar({ currentPage, navigate, logout, userRole }: Props) {
  const menuByRole: Record<UserRole, { label: string; page: string }[]> = {
    dean: [
      { label: 'Dashboard', page: 'dean-dashboard' },
    ],
    hr: [
      { label: 'Dashboard', page: 'hr-dashboard' },
    ],
    chair: [
      { label: 'Dashboard', page: 'chair-dashboard' },
    ],
    interviewer: [
      { label: 'Dashboard', page: 'interviewer-dashboard' },
    ],
  };

  return (
    <aside className="w-64 bg-[#002147] text-white flex flex-col">
      <div className="flex-1">
        {menuByRole[userRole].map((item) => (
          <button
            key={item.page}
            onClick={() => navigate(item.page)}
            className={`w-full text-left px-6 py-3 hover:bg-[#003366] ${
              currentPage === item.page ? 'bg-[#003366]' : ''
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <button
        onClick={logout}
        className="px-6 py-3 text-left hover:bg-red-600"
      >
        Logout
      </button>
    </aside>
  );
}
