import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  X, 
  Users, 
  UserPlus, 
  KeyRound, 
  Trash2, 
  RefreshCcw, 
  Loader2, 
  Search,
  Mail,
  User,
  Shield,
  CheckCircle2,
  AlertCircle,
  MoreHorizontal,
  Settings,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { auth } from '../firebase';

interface UserData {
  uid: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  createdAt: any;
  updatedAt: any;
}

interface AdminDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ isOpen, onClose, userRole }) => {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'users' | 'settings'>('users');
  
  // New user form
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    displayName: '',
    role: 'user' as 'user' | 'admin'
  });

  const [notification, setNotification] = useState<{type: 'success' | 'error', message: string} | null>(null);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const fetchUsers = async () => {
    if (userRole !== 'admin') return;
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.users) {
        setUsers(data.users);
      } else {
        const errorMsg = data.actionRequired 
          ? `${data.error}\n\n${data.actionRequired}`
          : (data.error || 'Failed to fetch users');
        throw new Error(errorMsg);
      }
    } catch (e: any) {
      showNotification('error', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
    }
  }, [isOpen]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.email || !newUser.password) {
      showNotification('error', 'Vui lòng nhập email và mật khẩu');
      return;
    }

    setIsCreating(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newUser)
      });
      const data = await response.json();
      
      if (response.ok) {
        showNotification('success', 'Đã tạo người dùng thành công');
        setNewUser({ email: '', password: '', displayName: '', role: 'user' });
        fetchUsers();
      } else {
        const errorMsg = data.actionRequired 
          ? `${data.error}\n\n${data.actionRequired}`
          : (data.error || 'Failed to create user');
        throw new Error(errorMsg);
      }
    } catch (e: any) {
      showNotification('error', e.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteUser = async (uid: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa người dùng này? Thao tác này không thể hoàn tác.')) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uid })
      });
      const data = await response.json();
      
      if (response.ok) {
        showNotification('success', 'Đã xóa người dùng thành công');
        fetchUsers();
      } else {
        throw new Error(data.error || 'Failed to delete user');
      }
    } catch (e: any) {
      showNotification('error', e.message);
    }
  };

  const handleUpdateRole = async (uid: string, newRole: 'user' | 'admin') => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/update-user-role', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uid, role: newRole })
      });
      const data = await response.json();
      
      if (response.ok) {
        showNotification('success', 'Đã cập nhật vai trò thành công');
        fetchUsers();
      } else {
        throw new Error(data.error || 'Failed to update role');
      }
    } catch (e: any) {
      showNotification('error', e.message);
    }
  };

  const handleResetPassword = async (uid: string, email: string) => {
    const newPass = window.prompt(`Nhập mật khẩu mới cho ${email}:`);
    if (!newPass) return;
    if (newPass.length < 6) {
      showNotification('error', 'Mật khẩu phải có ít nhất 6 ký tự');
      return;
    }

    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uid, newPassword: newPass })
      });
      const data = await response.json();
      
      if (response.ok) {
        showNotification('success', 'Đã đặt lại mật khẩu thành công');
      } else {
        throw new Error(data.error || 'Failed to reset password');
      }
    } catch (e: any) {
      showNotification('error', e.message);
    }
  };

  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (u.displayName && u.displayName.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
          />
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white w-full max-w-5xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-white/20"
          >
            {/* Header */}
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-white/80 backdrop-blur-xl sticky top-0 z-20">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
                  <ShieldCheck className="text-white w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-2xl font-display font-bold text-slate-900">Quản trị hệ thống</h3>
                  <p className="text-sm text-slate-500 font-medium">Quản lý người dùng và cấu hình ứng dụng</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-3 hover:bg-slate-100 rounded-2xl transition-all text-slate-400 hover:text-slate-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Notification Toast */}
            <AnimatePresence>
              {notification && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className={cn(
                    "absolute top-24 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3 border",
                    notification.type === 'success' ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-rose-50 border-rose-100 text-rose-700"
                  )}
                >
                  {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                  <span className="text-sm font-bold">{notification.message}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex-1 overflow-hidden flex">
              {/* Sidebar Tabs */}
              <div className="w-64 border-r border-slate-100 p-6 flex flex-col gap-2 bg-slate-50/50">
                <button 
                  onClick={() => setActiveTab('users')}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all",
                    activeTab === 'users' ? "bg-white text-indigo-600 shadow-sm border border-slate-100" : "text-slate-500 hover:bg-slate-100"
                  )}
                >
                  <Users className="w-5 h-5" />
                  Người dùng
                </button>
                <button 
                  onClick={() => setActiveTab('settings')}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all",
                    activeTab === 'settings' ? "bg-white text-indigo-600 shadow-sm border border-slate-100" : "text-slate-500 hover:bg-slate-100"
                  )}
                >
                  <Settings className="w-5 h-5" />
                  Cài đặt
                </button>
                
                <div className="mt-auto p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                  <div className="flex items-center gap-2 mb-2">
                    <Database className="w-4 h-4 text-indigo-600" />
                    <span className="text-xs font-black text-indigo-600 uppercase tracking-wider">Hệ thống</span>
                  </div>
                  <p className="text-[10px] text-indigo-400 font-medium leading-relaxed">
                    Phiên bản: 2.4.0<br/>
                    Trạng thái: Hoạt động tốt
                  </p>
                </div>
              </div>

              {/* Main Content Area */}
              <div className="flex-1 overflow-y-auto p-8 no-scrollbar bg-white">
                {activeTab === 'users' ? (
                  <div className="space-y-10">
                    {/* Create User Section */}
                    <section>
                      <div className="flex items-center gap-3 mb-6">
                        <div className="w-2 h-6 bg-indigo-500 rounded-full" />
                        <h4 className="text-lg font-bold text-slate-900">Thêm thành viên mới</h4>
                      </div>
                      
                      <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 bg-slate-50/80 p-6 rounded-[2rem] border border-slate-100">
                        <div className="space-y-2">
                          <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider ml-1">Tên hiển thị</label>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input 
                              type="text"
                              placeholder="Nguyễn Văn A"
                              value={newUser.displayName}
                              onChange={(e) => setNewUser({...newUser, displayName: e.target.value})}
                              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-sm"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider ml-1">Email</label>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input 
                              type="email"
                              placeholder="email@example.com"
                              value={newUser.email}
                              onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-sm"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider ml-1">Mật khẩu</label>
                          <div className="relative">
                            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input 
                              type="password"
                              placeholder="••••••••"
                              value={newUser.password}
                              onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-sm"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider ml-1">Vai trò</label>
                          <div className="relative">
                            <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <select 
                              value={newUser.role}
                              onChange={(e) => setNewUser({...newUser, role: e.target.value as 'user' | 'admin'})}
                              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none cursor-pointer shadow-sm font-bold text-slate-700"
                            >
                              <option value="user">Người dùng</option>
                              <option value="admin">Quản trị viên</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex items-end">
                          <button 
                            type="submit"
                            disabled={isCreating}
                            className="w-full py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-indigo-100 active:scale-95"
                          >
                            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                            Tạo mới
                          </button>
                        </div>
                      </form>
                    </section>

                    {/* User List Section */}
                    <section>
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-6 bg-amber-500 rounded-full" />
                          <h4 className="text-lg font-bold text-slate-900">Danh sách thành viên</h4>
                          <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-[10px] font-black uppercase tracking-widest">
                            {users.length} Tổng số
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <div className="relative w-full md:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input 
                              type="text"
                              placeholder="Tìm kiếm email, tên..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                          </div>
                          <button 
                            onClick={fetchUsers}
                            className="p-2 hover:bg-slate-100 text-slate-500 rounded-xl transition-all border border-slate-100 bg-white shadow-sm"
                            title="Làm mới"
                          >
                            <RefreshCcw className={cn("w-4 h-4", loading && "animate-spin")} />
                          </button>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-100 rounded-[2rem] overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50/50 text-slate-400 font-black uppercase tracking-[0.15em] text-[10px] border-b border-slate-100">
                              <tr>
                                <th className="px-8 py-5">Thành viên</th>
                                <th className="px-8 py-5">Vai trò</th>
                                <th className="px-8 py-5">Ngày tạo</th>
                                <th className="px-8 py-5 text-right">Hành động</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {loading && users.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className="px-8 py-20 text-center">
                                    <div className="flex flex-col items-center gap-3">
                                      <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                                      <p className="text-slate-400 font-medium italic">Đang tải dữ liệu...</p>
                                    </div>
                                  </td>
                                </tr>
                              ) : filteredUsers.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className="px-8 py-20 text-center">
                                    <div className="flex flex-col items-center gap-3">
                                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                                        <Users className="w-8 h-8 text-slate-200" />
                                      </div>
                                      <p className="text-slate-400 font-medium italic">Không tìm thấy người dùng nào</p>
                                    </div>
                                  </td>
                                </tr>
                              ) : (
                                filteredUsers.map((u) => (
                                  <tr key={u.uid} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="px-8 py-5">
                                      <div className="flex items-center gap-4">
                                        <div className="w-11 h-11 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-sm font-black text-white shadow-lg shadow-indigo-100">
                                          {u.displayName ? u.displayName.charAt(0).toUpperCase() : u.email.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                          <p className="font-bold text-slate-900">{u.displayName || 'Chưa đặt tên'}</p>
                                          <p className="text-xs text-slate-400 font-medium">{u.email}</p>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-8 py-5">
                                      <select 
                                        value={u.role}
                                        onChange={(e) => handleUpdateRole(u.uid, e.target.value as 'user' | 'admin')}
                                        className={cn(
                                          "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border outline-none transition-all appearance-none cursor-pointer text-center min-w-[120px]",
                                          u.role === 'admin' 
                                            ? "bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100" 
                                            : "bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100"
                                        )}
                                      >
                                        <option value="user">Thành viên</option>
                                        <option value="admin">Quản trị viên</option>
                                      </select>
                                    </td>
                                    <td className="px-8 py-5">
                                      <div className="flex flex-col">
                                        <span className="text-slate-600 font-bold text-xs">
                                          {u.createdAt ? (typeof u.createdAt === 'string' ? new Date(u.createdAt).toLocaleDateString('vi-VN') : (u.createdAt._seconds ? new Date(u.createdAt._seconds * 1000).toLocaleDateString('vi-VN') : 'N/A')) : 'N/A'}
                                        </span>
                                        <span className="text-[10px] text-slate-300 font-mono">
                                          ID: {u.uid.substring(0, 8)}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-8 py-5 text-right">
                                      <div className="flex items-center justify-end gap-2">
                                        <button 
                                          onClick={() => handleResetPassword(u.uid, u.email)}
                                          className="p-2.5 hover:bg-amber-50 text-amber-600 rounded-xl transition-all border border-transparent hover:border-amber-100"
                                          title="Đổi mật khẩu"
                                        >
                                          <KeyRound className="w-4 h-4" />
                                        </button>
                                        <button 
                                          onClick={() => handleDeleteUser(u.uid)}
                                          className="p-2.5 hover:bg-rose-50 text-rose-600 rounded-xl transition-all border border-transparent hover:border-rose-100"
                                          title="Xóa người dùng"
                                          disabled={u.email === auth.currentUser?.email}
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </section>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-2 h-6 bg-purple-500 rounded-full" />
                      <h4 className="text-lg font-bold text-slate-900">Cấu hình hệ thống</h4>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100 space-y-4">
                        <h5 className="font-bold text-slate-800 flex items-center gap-2">
                          <Database className="w-4 h-4 text-indigo-500" />
                          Cơ sở dữ liệu
                        </h5>
                        <p className="text-sm text-slate-500">
                          Quản lý các chỉ mục Firestore và cấu hình lưu trữ.
                        </p>
                        <button className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all">
                          Kiểm tra kết nối
                        </button>
                      </div>
                      
                      <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100 space-y-4">
                        <h5 className="font-bold text-slate-800 flex items-center gap-2">
                          <Shield className="w-4 h-4 text-amber-500" />
                          Bảo mật
                        </h5>
                        <p className="text-sm text-slate-500">
                          Cấu hình quy tắc bảo mật và giới hạn truy cập.
                        </p>
                        <button className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all">
                          Xem nhật ký bảo mật
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                © 2024 Medical Translation Admin Panel
              </p>
              <button 
                onClick={onClose}
                className="px-8 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm active:scale-95"
              >
                Đóng
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
