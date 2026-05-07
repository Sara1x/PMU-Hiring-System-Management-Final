import type { UserRole } from "../types/userRole";

interface Props {
  userName: string;
  userTitle: string;
  navigate: (page: string) => void;
  userRole: UserRole;
}

export function TopNavigation({ userName, userTitle }: Props) {
  return (
    <header className="h-16 bg-white border-b flex items-center justify-between px-6">
      <h3 className="text-[#002147]">Academic Hiring System</h3>
      <div className="text-right">
        <p className="font-semibold">{userName}</p>
        <p className="text-sm text-gray-500">{userTitle}</p>
      </div>
    </header>
  );
}
