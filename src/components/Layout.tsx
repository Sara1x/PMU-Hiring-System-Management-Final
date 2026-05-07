import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  navigate: (path: string) => void;
  logout: () => void;
  userName: string;
  userTitle: string;
}

export function Layout({
  children,
  navigate,
  logout,
  userName,
  userTitle,
}: Props) {
  return (
    <div className="h-screen flex bg-gray-100">
      <aside className="w-64 bg-[#002147] text-white p-6">
        <h2 className="text-xl font-bold mb-6">PMU System</h2>

        <button
          className="block w-full text-left mb-3 hover:underline"
          onClick={() => navigate("/dean")}
        >
          Dashboard
        </button>

        <button
          className="block w-full text-left hover:underline"
          onClick={logout}
        >
          Logout
        </button>
      </aside>

      <div className="flex-1 flex flex-col">
        <header className="h-16 bg-white border-b flex items-center justify-end px-6">
          <div className="text-right">
            <p className="font-semibold">{userName}</p>
            <p className="text-sm text-gray-500">{userTitle}</p>
          </div>
        </header>

        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
