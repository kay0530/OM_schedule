import { useAuth } from '../../context/AuthContext';

/**
 * Authentication gate. Blocks the app until the user signs in with
 * an allowed Azure AD account. Rendered when isAuthenticated is false.
 */
export default function LoginGate() {
  const { login, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <svg className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-gray-500">認証状態を確認中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 via-white to-blue-50 px-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 border border-gray-100">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-orange-600 rounded-xl flex items-center justify-center">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">O&M予定表</h1>
            <p className="text-xs text-gray-500">パワまる工事予定表</p>
          </div>
        </div>

        <div className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-2">ログインが必要です</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            このアプリはAltenergy社員専用です。<br />
            会社のMicrosoft 365アカウント（@altenergy.co.jp）でサインインしてください。
          </p>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={login}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors shadow-sm"
        >
          <svg className="w-5 h-5" viewBox="0 0 23 23" fill="none">
            <rect x="1" y="1" width="10" height="10" fill="#F25022" />
            <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
            <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
            <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
          </svg>
          Microsoft 365でサインイン
        </button>

        <p className="mt-6 text-xs text-gray-400 text-center">
          ログインできない場合はシステム管理者に連絡してください
        </p>
      </div>
    </div>
  );
}
