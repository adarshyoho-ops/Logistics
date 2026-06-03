import React, { useState, useEffect } from 'react';
import {
  Plus,
  Clock,
  Truck,
  User,
  CheckCircle,
  XCircle,
  AlertCircle,
  MapPin,
  TrendingUp,
  RefreshCw,
  LogOut,
  Activity,
  FileText,
  Check,
  Eye
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import api from './api';
import { connectSocket, disconnectSocket } from './socket';

// Types
interface UserType {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'client' | 'rider';
  status?: 'available' | 'offline';
  totalDelivered?: number;
  totalFailed?: number;
  avgDeliveryTime?: number;
}

interface TimelineEvent {
  status: 'pending' | 'assigned' | 'picked_up' | 'delivered' | 'failed';
  timestamp: string;
  details: string;
}

interface OrderType {
  _id: string;
  pickupAddress: string;
  dropAddress: string;
  packageDetails: string;
  priority: 'normal' | 'urgent';
  status: 'pending' | 'assigned' | 'picked_up' | 'delivered' | 'failed';
  client: string | UserType;
  rider?: string | UserType;
  zone: string;
  timeline: TimelineEvent[];
  proofPhoto?: string;
  failedReason?: string;
  timeTaken?: number;
  createdAt: string;
  updatedAt: string;
}

interface AnalyticsType {
  totalOrders: number;
  activeOrders: number;
  deliveredOrders: number;
  failedOrders: number;
  avgDeliveryTime: number;
  performanceByZone: { name: string; count: number }[];
}

export default function App() {
  // Navigation & Authentication state
  const [user, setUser] = useState<UserType | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLogin, setIsLogin] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'client' | 'rider'>('client');

  // Dashboard Data states
  const [orders, setOrders] = useState<OrderType[]>([]);
  const [ridersList, setRidersList] = useState<UserType[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsType | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  // Filter states (Admin)
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPriority, setFilterPriority] = useState<string>('');
  const [filterZone, setFilterZone] = useState<string>('');

  // Booking Form states (Client)
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropAddress, setDropAddress] = useState('');
  const [packageDetails, setPackageDetails] = useState('');
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [bookingError, setBookingError] = useState('');
  const [bookingSuccess, setBookingSuccess] = useState('');

  // Modal / Detail states
  const [selectedOrder, setSelectedOrder] = useState<OrderType | null>(null);
  const [riderProofModal, setRiderProofModal] = useState<{
    orderId: string;
    action: 'deliver' | 'fail';
  } | null>(null);
  const [proofText, setProofText] = useState('');
  const [failReasonText, setFailReasonText] = useState('Client unavailable');

  // Socket notification states
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'info'; text: string } | null>(null);

  // Auto Dismiss Toast
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Load user on token change
  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
      // Decode JWT token loosely to set user state
      try {
        const payloadBase64 = token.split('.')[1];
        const payload = JSON.parse(atob(payloadBase64));
        setUser({
          id: payload.sub,
          name: payload.name || payload.email.split('@')[0],
          email: payload.email,
          role: payload.role,
        });
      } catch (e) {
        console.error('Failed to decode token:', e);
        handleLogout();
      }
    } else {
      localStorage.removeItem('token');
      setUser(null);
    }
  }, [token]);

  // Connect to Websockets when user/token are available
  useEffect(() => {
    if (token && user) {
      const socket = connectSocket(token);

      // Listen for socket events
      socket.on('order_updated', (updatedOrder: OrderType) => {
        setOrders((prev) => {
          const index = prev.findIndex((o) => o._id === updatedOrder._id);
          if (index === -1) {
            return [updatedOrder, ...prev];
          }
          const updated = [...prev];
          updated[index] = updatedOrder;
          return updated;
        });

        // Trigger notifications
        if (user.role === 'admin') {
          setToastMessage({
            type: 'info',
            text: `Order #${updatedOrder._id.slice(-6)} status updated to ${updatedOrder.status}.`,
          });
        }

        // Auto reload analytics if admin
        if (user.role === 'admin') {
          loadAnalytics();
        }
      });

      socket.on('order_assigned', (data: { orderId: string; riderName: string }) => {
        setToastMessage({
          type: 'success',
          text: `Your order #${data.orderId.slice(-6)} has been assigned to Rider ${data.riderName}!`,
        });
        loadOrders();
      });

      socket.on('order_delivered', (data: { orderId: string }) => {
        setToastMessage({
          type: 'success',
          text: `🎉 Order #${data.orderId.slice(-6)} has been successfully delivered!`,
        });
        loadOrders();
      });

      return () => {
        disconnectSocket();
      };
    }
  }, [token, user]);

  // Load Dashboard Data
  useEffect(() => {
    if (user) {
      loadOrders();
      if (user.role === 'admin') {
        loadAnalytics();
        loadRiders();
      }
    }
  }, [user, filterStatus, filterPriority, filterZone]);

  const loadOrders = async () => {
    if (!user) return;
    try {
      setLoadingData(true);
      let response;
      if (user.role === 'admin') {
        response = await api.get('/orders', {
          params: {
            status: filterStatus || undefined,
            priority: filterPriority || undefined,
            zone: filterZone || undefined,
          },
        });
        setOrders(response.data.orders);
      } else {
        // Client or Rider
        response = await api.get('/orders/my');
        setOrders(response.data);
      }
    } catch (e) {
      console.error('Error loading orders:', e);
    } finally {
      setLoadingData(false);
    }
  };

  const loadRiders = async () => {
    try {
      const res = await api.get('/riders');
      setRidersList(res.data);
    } catch (e) {
      console.error('Error loading riders:', e);
    }
  };

  const loadAnalytics = async () => {
    try {
      const res = await api.get('/analytics/summary');
      setAnalytics(res.data);
    } catch (e) {
      console.error('Error loading analytics:', e);
    }
  };

  // Auth actions
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      if (isLogin) {
        const response = await api.post('/auth/login', { email, password });
        setToken(response.data.token);
      } else {
        const response = await api.post('/auth/register', { name, email, password, role });
        setToken(response.data.token);
      }
    } catch (err: any) {
      console.error(err);
      setAuthError(err.response?.data?.message || 'Authentication failed. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    disconnectSocket();
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
  };

  // Client actions
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setBookingError('');
    setBookingSuccess('');

    if (!pickupAddress || !dropAddress || !packageDetails) {
      setBookingError('All fields are required.');
      return;
    }

    try {
      await api.post('/orders', {
        pickupAddress,
        dropAddress,
        packageDetails,
        priority,
      });
      setBookingSuccess('Order placed successfully!');
      setPickupAddress('');
      setDropAddress('');
      setPackageDetails('');
      setPriority('normal');
      loadOrders();
    } catch (err: any) {
      setBookingError(err.response?.data?.message || 'Failed to place order.');
    }
  };

  // Rider actions
  const handleUpdateRiderStatus = async (status: 'available' | 'offline') => {
    if (!user) return;
    try {
      await api.patch(`/riders/${user.id}/status`, { status });
      setUser((prev) => prev ? { ...prev, status } : null);
      setToastMessage({ type: 'success', text: `You are now ${status === 'available' ? 'Online' : 'Offline'}` });
      loadOrders();

      // Simulate random coordinates location update when rider goes online
      if (status === 'available') {
        await api.patch('/riders/location', {
          lat: 12.9716 + (Math.random() - 0.5) * 0.1,
          lng: 77.5946 + (Math.random() - 0.5) * 0.1,
        });
      }
    } catch (err) {
      console.error('Failed to update rider status:', err);
    }
  };

  const handleRiderOrderAction = async (orderId: string, status: 'picked_up' | 'delivered' | 'failed') => {
    if (status === 'delivered') {
      setRiderProofModal({ orderId, action: 'deliver' });
      setProofText('');
    } else if (status === 'failed') {
      setRiderProofModal({ orderId, action: 'fail' });
      setFailReasonText('Client unavailable');
    } else {
      try {
        await api.patch(`/orders/${orderId}/status`, { status });
        // Optimistically update local state so UI reflects new status immediately
        setOrders((prev) =>
          prev.map((o) => (o._id === orderId ? { ...o, status } : o))
        );
        setToastMessage({ type: 'success', text: 'Order marked as Picked Up!' });
        loadOrders();
      } catch (err: any) {
        alert(err.response?.data?.message || 'Failed to update order status');
      }
    }
  };

  const submitRiderProof = async () => {
    if (!riderProofModal) return;
    const { orderId, action } = riderProofModal;
    try {
      if (action === 'deliver') {
        await api.patch(`/orders/${orderId}/status`, {
          status: 'delivered',
          proofPhoto: proofText || 'Standard Hand Delivery Verified',
        });
        setToastMessage({ type: 'success', text: 'Order successfully delivered! 🎉' });
      } else {
        await api.patch(`/orders/${orderId}/status`, {
          status: 'failed',
          failedReason: failReasonText,
        });
        setToastMessage({ type: 'info', text: 'Order marked as failed.' });
      }
      setRiderProofModal(null);
      loadOrders();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to submit status update.');
    }
  };

  // Helper getters
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
      case 'assigned': return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
      case 'picked_up': return 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
      case 'delivered': return 'bg-green-500/10 text-green-400 border border-green-500/20';
      case 'failed': return 'bg-red-500/10 text-red-400 border border-red-500/20';
      default: return 'bg-slate-500/10 text-slate-400 border border-slate-500/20';
    }
  };

  const getPriorityColor = (priority: string) => {
    return priority === 'urgent'
      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
      : 'bg-slate-500/10 text-slate-400 border border-slate-500/20';
  };

  // Render Login/Signup view
  if (!user) {
    return (
      <div className="min-h-screen bg-[#090b0e] flex flex-col justify-center items-center px-4 relative overflow-hidden font-sans">
        {/* Glow Effects */}
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-600/15 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-blue-600/15 rounded-full blur-[120px] pointer-events-none" />

        <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-xl border border-slate-800 p-8 rounded-2xl shadow-2xl relative z-10">
          <div className="text-center mb-8">
            <div className="inline-flex p-3 bg-purple-500/10 rounded-2xl mb-4 border border-purple-500/20 text-purple-400">
              <Truck size={36} />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white m-0">Logistics Live</h1>
            <p className="text-slate-400 text-sm mt-1">Real-time parcel delivery operations</p>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Email Address</label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Password</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition"
              />
            </div>

            {!isLogin && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Select Role</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['client', 'rider', 'admin'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`py-2 px-3 rounded-lg border text-sm capitalize transition ${role === r
                        ? 'bg-purple-500/25 border-purple-500 text-purple-300'
                        : 'bg-slate-950/30 border-slate-800 text-slate-400 hover:bg-slate-950/60'
                        }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {authError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl flex items-center gap-2 text-sm">
                <AlertCircle size={18} />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-purple-600 hover:bg-purple-500 text-white rounded-xl py-3 font-semibold transition shadow-lg shadow-purple-600/25 cursor-pointer disabled:opacity-50"
            >
              {authLoading ? 'Please wait...' : isLogin ? 'Login to Dashboard' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm">
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setAuthError('');
              }}
              className="text-slate-400 hover:text-purple-400 transition"
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Login'}
            </button>
          </div>

          {/* Test credentials helper */}
          {isLogin && (
            <div className="mt-8 border-t border-slate-800/80 pt-6">
              <div className="bg-slate-950/40 border border-slate-800/60 p-4 rounded-xl text-xs text-slate-400">
                <h4 className="font-semibold text-slate-300 mb-2">💡 Quick Setup Guide:</h4>
                <p className="mb-2">Create new accounts by toggling the register screen, select your desired role, and test live real-time synchronization between tabs.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render main app dashboards
  return (
    <div className="min-h-screen bg-[#08090d] text-slate-100 flex flex-col font-sans relative pb-12">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 animate-bounce bg-slate-900 border border-purple-500/30 text-white px-5 py-4 rounded-2xl shadow-2xl flex items-center gap-3 max-w-md">
          {toastMessage.type === 'success' ? (
            <div className="p-1 bg-green-500/10 text-green-400 rounded-full border border-green-500/20">
              <CheckCircle size={20} />
            </div>
          ) : (
            <div className="p-1 bg-purple-500/10 text-purple-400 rounded-full border border-purple-500/20">
              <Activity size={20} />
            </div>
          )}
          <span className="text-sm font-medium">{toastMessage.text}</span>
        </div>
      )}

      {/* Header */}
      <header className="bg-slate-950/60 backdrop-blur-md border-b border-slate-800/60 sticky top-0 z-40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/15 rounded-xl border border-purple-500/30 text-purple-400">
              <Truck size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white m-0 leading-none">Logistics Live</h1>
              <span className="text-[10px] text-slate-400 uppercase tracking-widest mt-1 block">Live Operations Console</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800/80 px-4 py-2 rounded-xl">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-ping" />
              <div className="text-xs">
                <span className="text-slate-400">Signed in as </span>
                <strong className="text-white">{user.name}</strong>
                <span className="text-purple-400 capitalize font-medium ml-1">({user.role})</span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:text-rose-400 text-slate-400 rounded-xl transition cursor-pointer"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Content wrapper */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 mt-8">

        {/* --- ADMIN DASHBOARD --- */}
        {user.role === 'admin' && (
          <div className="space-y-8">
            {/* KPI Metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between">
                <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Total Bookings</span>
                <span className="text-3xl font-extrabold text-white mt-2">{analytics?.totalOrders ?? orders.length}</span>
              </div>
              <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between">
                <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Active Deliveries</span>
                <span className="text-3xl font-extrabold text-purple-400 mt-2">{analytics?.activeOrders ?? orders.filter(o => ['assigned', 'picked_up'].includes(o.status)).length}</span>
              </div>
              <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between">
                <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Completed</span>
                <span className="text-3xl font-extrabold text-green-400 mt-2">{analytics?.deliveredOrders ?? orders.filter(o => o.status === 'delivered').length}</span>
              </div>
              <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between">
                <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Failed</span>
                <span className="text-3xl font-extrabold text-rose-400 mt-2">{analytics?.failedOrders ?? orders.filter(o => o.status === 'failed').length}</span>
              </div>
              <div className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between col-span-2 lg:col-span-1">
                <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Avg Time Taken</span>
                <span className="text-3xl font-extrabold text-blue-400 mt-2">{(analytics?.avgDeliveryTime || 0) > 0 ? `${analytics?.avgDeliveryTime}m` : 'N/A'}</span>
              </div>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 p-6 rounded-2xl">
                <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                  <TrendingUp size={18} className="text-purple-400" />
                  Order Trends & Performance
                </h3>
                <div className="h-64">
                  {orders.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-slate-500">No data available yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={
                          // Dynamic trend chart based on last few orders
                          orders.slice(0, 10).reverse().map((o) => ({
                            name: `O-${o._id.slice(-4)}`,
                            time: o.timeTaken || 15,
                          }))
                        }
                      >
                        <defs>
                          <linearGradient id="colorTime" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                        <YAxis stroke="#64748b" fontSize={12} unit="m" />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
                        <Area type="monotone" dataKey="time" stroke="#a855f7" fillOpacity={1} fill="url(#colorTime)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-2xl">
                <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                  <Activity size={18} className="text-purple-400" />
                  Zone Distribution
                </h3>
                <div className="h-64">
                  {(!analytics || !analytics.performanceByZone || analytics.performanceByZone.length === 0) ? (
                    <div className="h-full flex items-center justify-center text-sm text-slate-500">No zone data available</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.performanceByZone}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                        <YAxis stroke="#64748b" fontSize={12} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
                        <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Main grid: Orders Feed & Riders list */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Live Orders Feed */}
              <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 p-6 rounded-2xl flex flex-col">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <h3 className="text-base font-bold text-white flex items-center gap-2 m-0">
                    <FileText size={18} className="text-purple-400" />
                    Live Orders Stream
                  </h3>

                  {/* Filters */}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-purple-500"
                    >
                      <option value="">All Statuses</option>
                      <option value="pending">Pending</option>
                      <option value="assigned">Assigned</option>
                      <option value="picked_up">Picked Up</option>
                      <option value="delivered">Delivered</option>
                      <option value="failed">Failed</option>
                    </select>
                    <select
                      value={filterPriority}
                      onChange={(e) => setFilterPriority(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-purple-500"
                    >
                      <option value="">All Priorities</option>
                      <option value="normal">Normal</option>
                      <option value="urgent">Urgent</option>
                    </select>
                    <select
                      value={filterZone}
                      onChange={(e) => setFilterZone(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-purple-500"
                    >
                      <option value="">All Zones</option>
                      <option value="North">North</option>
                      <option value="South">South</option>
                      <option value="East">East</option>
                      <option value="West">West</option>
                      <option value="Central">Central</option>
                    </select>
                    <button
                      onClick={() => {
                        setFilterStatus('');
                        setFilterPriority('');
                        setFilterZone('');
                      }}
                      className="p-1.5 bg-slate-950 border border-slate-800 hover:bg-slate-900 text-slate-400 rounded-lg"
                      title="Clear filters"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                </div>

                {loadingData ? (
                  <div className="flex-1 py-12 flex flex-col items-center justify-center text-slate-500">
                    <RefreshCw size={24} className="animate-spin mb-2" />
                    <span>Loading live feed...</span>
                  </div>
                ) : orders.length === 0 ? (
                  <div className="flex-1 py-12 flex flex-col items-center justify-center text-slate-500 text-sm">
                    No orders matching the active filters
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800/80 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                          <th className="pb-3">ID</th>
                          <th className="pb-3">Client</th>
                          <th className="pb-3">Details</th>
                          <th className="pb-3">Priority</th>
                          <th className="pb-3">Status</th>
                          <th className="pb-3">Rider</th>
                          <th className="pb-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 text-sm">
                        {orders.map((o) => (
                          <tr key={o._id} className="hover:bg-slate-900/10 transition-colors">
                            <td className="py-4.5 font-mono text-xs text-slate-400">#{o._id.slice(-6)}</td>
                            <td className="py-4.5 font-medium text-white">{(o.client as any)?.name || 'Unknown'}</td>
                            <td className="py-4.5">
                              <div className="max-w-[200px] truncate font-medium">{o.packageDetails}</div>
                              <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                <MapPin size={12} />
                                <span className="truncate">{o.dropAddress}</span>
                              </div>
                            </td>
                            <td className="py-4.5">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getPriorityColor(o.priority)}`}>
                                {o.priority}
                              </span>
                            </td>
                            <td className="py-4.5">
                              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${getStatusColor(o.status)}`}>
                                {o.status.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="py-4.5 font-medium text-slate-300">
                              {o.rider ? (
                                <span className="flex items-center gap-1.5">
                                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                                  {(o.rider as any).name}
                                </span>
                              ) : (
                                <span className="text-slate-600 italic">Unassigned</span>
                              )}
                            </td>
                            <td className="py-4.5 text-right">
                              <button
                                onClick={() => setSelectedOrder(o)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-slate-300 border border-slate-800 rounded-lg transition cursor-pointer"
                              >
                                <Eye size={12} /> View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Riders Board */}
              <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-2xl">
                <h3 className="text-base font-bold text-white mb-6 flex items-center gap-2">
                  <User size={18} className="text-purple-400" />
                  Riders Registry
                </h3>

                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
                  {ridersList.length === 0 ? (
                    <div className="text-center py-8 text-sm text-slate-500">No riders registered yet</div>
                  ) : (
                    ridersList.map((r) => (
                      <div key={r.id} className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-purple-300 text-sm">
                              {r.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${r.status === 'available' ? 'bg-green-500' : 'bg-slate-600'}`} />
                          </div>
                          <div>
                            <span className="font-semibold text-sm text-white block leading-none">{r.name}</span>
                            <span className="text-[10px] text-slate-500 uppercase tracking-wide mt-1 block">Rider ID: {r.id.slice(-6)}</span>
                          </div>
                        </div>

                        <div className="text-right text-xs">
                          <span className="text-slate-400 block font-medium">Delivered: {r.totalDelivered || 0}</span>
                          <span className="text-slate-500 mt-0.5 block">Avg Speed: {r.avgDeliveryTime || 0}m</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* --- CLIENT DASHBOARD --- */}
        {user.role === 'client' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* Booking Panel */}
            <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-2xl">
              <h3 className="text-base font-bold text-white mb-5 flex items-center gap-2">
                <Plus size={18} className="text-purple-400" />
                Book Delivery Order
              </h3>

              <form onSubmit={handleCreateOrder} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Pickup Address</label>
                  <input
                    type="text"
                    required
                    placeholder="123 North Ave, City"
                    value={pickupAddress}
                    onChange={(e) => setPickupAddress(e.target.value)}
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-purple-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Dropoff Address</label>
                  <input
                    type="text"
                    required
                    placeholder="456 South Rd, City"
                    value={dropAddress}
                    onChange={(e) => setDropAddress(e.target.value)}
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-purple-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Package Details</label>
                  <textarea
                    required
                    rows={3}
                    placeholder="1x Electronics box (Fragile, 2kg)"
                    value={packageDetails}
                    onChange={(e) => setPackageDetails(e.target.value)}
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-purple-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Priority Level</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPriority('normal')}
                      className={`py-2 rounded-lg border text-xs font-medium transition capitalize ${priority === 'normal'
                        ? 'bg-slate-800 border-slate-700 text-slate-200'
                        : 'bg-slate-950/20 border-slate-800 text-slate-500'
                        }`}
                    >
                      Normal (Standby)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPriority('urgent')}
                      className={`py-2 rounded-lg border text-xs font-medium transition capitalize ${priority === 'urgent'
                        ? 'bg-rose-500/10 border-rose-500/50 text-rose-300'
                        : 'bg-slate-950/20 border-slate-800 text-slate-500'
                        }`}
                    >
                      ⚡ Urgent (Instant assignment)
                    </button>
                  </div>
                </div>

                {bookingError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl flex items-center gap-2 text-xs">
                    <AlertCircle size={16} />
                    <span>{bookingError}</span>
                  </div>
                )}

                {bookingSuccess && (
                  <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-3 rounded-xl flex items-center gap-2 text-xs font-semibold">
                    <CheckCircle size={16} />
                    <span>{bookingSuccess}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full bg-purple-600 hover:bg-purple-500 text-white rounded-xl py-2.5 font-semibold text-sm transition shadow-lg shadow-purple-600/20 cursor-pointer"
                >
                  Book Package Dispatch
                </button>
              </form>
            </div>

            {/* My Orders / Active Trackers */}
            <div className="lg:col-span-2 space-y-6">

              {/* Real-time status tracker of the most recent order */}
              {orders.length > 0 && orders[0] && (
                <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-2xl">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-base font-bold text-white m-0">Latest Order Live Tracking</h3>
                    <span className="font-mono text-xs text-slate-400">Order ID: #{orders[0]._id.slice(-6)}</span>
                  </div>

                  {/* Booking Timeline */}
                  <div className="grid grid-cols-5 gap-2 relative mt-8">
                    {/* Progress Lines */}
                    <div className="absolute top-3 left-[10%] right-[10%] h-0.5 bg-slate-800 z-0" />

                    {/* Calculate step progress */}
                    {['pending', 'assigned', 'picked_up', 'delivered'].map((step, idx) => {
                      const statuses = ['pending', 'assigned', 'picked_up', 'delivered', 'failed'];
                      const currentIdx = statuses.indexOf(orders[0].status);
                      const stepIdx = statuses.indexOf(step);

                      const isCompleted = orders[0].status === 'failed' ? false : currentIdx >= stepIdx;
                      const isFailed = orders[0].status === 'failed' && step === 'delivered';
                      const isActive = orders[0].status === step;

                      return (
                        <div key={step} className="flex flex-col items-center relative z-10">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center border text-[10px] font-bold ${isFailed ? 'bg-red-500/10 border-red-500 text-red-400' :
                            isCompleted ? 'bg-purple-500 border-purple-500 text-white shadow-lg shadow-purple-500/20' :
                              'bg-slate-950 border-slate-800 text-slate-500'
                            }`}>
                            {isCompleted ? <Check size={12} /> : idx + 1}
                          </div>
                          <span className={`text-[10px] uppercase font-bold tracking-wider mt-2 text-center capitalize ${isActive ? 'text-purple-400' : isCompleted ? 'text-slate-300' : 'text-slate-500'
                            }`}>
                            {step.replace('_', ' ')}
                          </span>
                        </div>
                      );
                    })}

                    {orders[0].status === 'failed' && (
                      <div className="flex flex-col items-center relative z-10">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center border bg-red-500 border-red-500 text-white shadow-lg shadow-red-500/20">
                          <XCircle size={12} />
                        </div>
                        <span className="text-[10px] uppercase font-bold tracking-wider mt-2 text-center text-red-400">
                          Failed
                        </span>
                      </div>
                    )}
                  </div>

                  {orders[0].rider && (
                    <div className="mt-6 bg-slate-950/50 p-4 rounded-xl border border-slate-800/80 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-300 text-xs">
                          {(orders[0].rider as any).name?.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <span className="text-xs text-slate-400 block font-medium">Assigned Rider</span>
                          <span className="text-sm font-semibold text-white">{(orders[0].rider as any).name}</span>
                        </div>
                      </div>
                      <div className="text-right text-xs">
                        <span className="text-slate-500 block">Status</span>
                        <span className="text-green-400 font-semibold uppercase tracking-wider text-[10px] mt-0.5 block">On Duty</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Order History */}
              <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-2xl">
                <h3 className="text-base font-bold text-white mb-5 flex items-center gap-2">
                  <Clock size={18} className="text-purple-400" />
                  Your Order Bookings
                </h3>

                {loadingData ? (
                  <div className="py-8 flex flex-col items-center justify-center text-slate-500">
                    <RefreshCw size={20} className="animate-spin mb-1" />
                    <span className="text-xs">Loading orders...</span>
                  </div>
                ) : orders.length === 0 ? (
                  <div className="text-center py-8 text-sm text-slate-500">You haven't booked any orders yet.</div>
                ) : (
                  <div className="space-y-3">
                    {orders.map((o) => (
                      <div key={o._id} className="bg-slate-950/30 border border-slate-850 p-4 rounded-xl flex items-center justify-between hover:bg-slate-950/60 transition">
                        <div>
                          <span className="font-mono text-xs text-slate-400 block">#{o._id.slice(-6)}</span>
                          <span className="font-semibold text-sm text-white mt-1 block">{o.packageDetails}</span>
                          <span className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                            <MapPin size={12} /> {o.dropAddress}
                          </span>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${getStatusColor(o.status)}`}>
                            {o.status.replace('_', ' ')}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${getPriorityColor(o.priority)}`}>
                            {o.priority}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* --- RIDER DASHBOARD --- */}
        {user.role === 'rider' && (
          <div className="space-y-6">

            {/* Status & Online Toggles */}
            <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white m-0">Rider Console</h2>
                <p className="text-xs text-slate-400 mt-1">Toggle your availability to start accepting delivery orders.</p>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-300">Duty Status:</span>
                <button
                  onClick={() => handleUpdateRiderStatus(user.status === 'available' ? 'offline' : 'available')}
                  className={`px-5 py-2 rounded-xl text-xs font-bold transition uppercase tracking-wider cursor-pointer ${user.status === 'available'
                    ? 'bg-green-600 text-white shadow-lg shadow-green-600/20'
                    : 'bg-slate-850 text-slate-400 border border-slate-800'
                    }`}
                >
                  {user.status === 'available' ? '🟢 Online' : '⚪ Offline'}
                </button>
              </div>
            </div>

            {/* Delivery list */}
            <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-2xl">
              <h3 className="text-base font-bold text-white mb-5 flex items-center gap-2">
                <Truck size={18} className="text-purple-400" />
                Assigned Deliveries
              </h3>

              {user.status !== 'available' ? (
                <div className="text-center py-12 text-slate-500">
                  <Activity size={36} className="mx-auto mb-2 text-slate-655/40 animate-pulse" />
                  <span className="text-sm">You are offline. Toggle status online to view jobs.</span>
                </div>
              ) : loadingData ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-500">
                  <RefreshCw size={24} className="animate-spin mb-2" />
                  <span className="text-sm">Loading assigned runs...</span>
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-12 text-sm text-slate-500">No active runs assigned to you at the moment.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {orders.map((o) => (
                    <div key={o._id} className="bg-slate-950/40 border border-slate-850 p-5 rounded-2xl flex flex-col justify-between hover:border-slate-800 transition">
                      <div className="space-y-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-mono text-xs text-slate-500 block">#{o._id.slice(-6)}</span>
                            <h4 className="font-bold text-base text-white mt-1 leading-snug">{o.packageDetails}</h4>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${getPriorityColor(o.priority)}`}>
                            {o.priority}
                          </span>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-start gap-2.5">
                            <div className="w-5 h-5 rounded-full bg-slate-900 border border-slate-850 flex items-center justify-center text-[10px] font-bold text-purple-400 shrink-0">A</div>
                            <div>
                              <span className="text-[10px] text-slate-500 block font-semibold uppercase tracking-wider">Pickup</span>
                              <span className="text-xs text-slate-300 font-medium">{o.pickupAddress}</span>
                            </div>
                          </div>
                          <div className="flex items-start gap-2.5">
                            <div className="w-5 h-5 rounded-full bg-slate-900 border border-slate-850 flex items-center justify-center text-[10px] font-bold text-blue-400 shrink-0">B</div>
                            <div>
                              <span className="text-[10px] text-slate-500 block font-semibold uppercase tracking-wider">Dropoff</span>
                              <span className="text-xs text-slate-300 font-medium">{o.dropAddress}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-slate-900/60 mt-6 pt-4 flex items-center justify-between">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${getStatusColor(o.status)}`}>
                          {o.status.replace('_', ' ')}
                        </span>

                        <div className="flex gap-2">
                          {o.status === 'assigned' && (
                            <button
                              onClick={() => handleRiderOrderAction(o._id, 'picked_up')}
                              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                            >
                              Mark Picked Up
                            </button>
                          )}
                          {o.status === 'picked_up' && (
                            <>
                              <button
                                onClick={() => handleRiderOrderAction(o._id, 'delivered')}
                                className="px-3.5 py-2 bg-green-600 hover:bg-green-500 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                              >
                                Complete
                              </button>
                              <button
                                onClick={() => handleRiderOrderAction(o._id, 'failed')}
                                className="px-3.5 py-2 bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 rounded-xl text-xs font-semibold transition cursor-pointer border border-rose-500/20"
                              >
                                Fail
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

      </main>

      {/* --- ORDER DETAIL MODAL (ADMIN) --- */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-2xl space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <span className="font-mono text-xs text-slate-500 block">Order Detail ID</span>
                <h3 className="text-lg font-bold text-white mt-1">#{selectedOrder._id}</h3>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 bg-slate-950 border border-slate-800 hover:bg-slate-900 rounded-lg text-slate-400 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-850">
                <span className="text-[10px] text-slate-500 block font-semibold uppercase tracking-wider">Package Details</span>
                <span className="text-slate-200 mt-1 block font-medium">{selectedOrder.packageDetails}</span>
              </div>
              <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-850">
                <span className="text-[10px] text-slate-500 block font-semibold uppercase tracking-wider">Zone Location</span>
                <span className="text-slate-200 mt-1 block font-medium">{selectedOrder.zone} Zone</span>
              </div>
              <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-850">
                <span className="text-[10px] text-slate-500 block font-semibold uppercase tracking-wider">Pickup Address</span>
                <span className="text-slate-200 mt-1 block font-medium">{selectedOrder.pickupAddress}</span>
              </div>
              <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-850">
                <span className="text-[10px] text-slate-500 block font-semibold uppercase tracking-wider">Dropoff Address</span>
                <span className="text-slate-200 mt-1 block font-medium">{selectedOrder.dropAddress}</span>
              </div>
            </div>

            {/* Timeline */}
            <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-850 space-y-3">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Delivery Log Activity</h4>
              <div className="space-y-3 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1px] before:bg-slate-800">
                {selectedOrder.timeline.map((event, idx) => (
                  <div key={idx} className="flex gap-4 items-start pl-5 relative">
                    <div className={`absolute left-0.5 top-1.5 w-3 h-3 rounded-full border-2 border-slate-900 ${event.status === 'delivered' ? 'bg-green-500' :
                      event.status === 'failed' ? 'bg-red-500' : 'bg-purple-500'
                      }`} />
                    <div className="text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white capitalize">{event.status.replace('_', ' ')}</span>
                        <span className="text-[10px] text-slate-500">{new Date(event.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-slate-400 mt-0.5">{event.details}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Proof of delivery / failure reasons */}
            {selectedOrder.status === 'delivered' && selectedOrder.proofPhoto && (
              <div className="bg-green-500/5 p-4 rounded-xl border border-green-500/10 text-xs">
                <span className="text-[10px] text-green-400 block font-bold uppercase tracking-wider">Proof of Delivery Verified</span>
                <span className="text-slate-300 mt-1 block font-mono">{selectedOrder.proofPhoto}</span>
              </div>
            )}

            {selectedOrder.status === 'failed' && selectedOrder.failedReason && (
              <div className="bg-red-500/5 p-4 rounded-xl border border-red-500/10 text-xs">
                <span className="text-[10px] text-red-400 block font-bold uppercase tracking-wider">Failure Reason Code</span>
                <span className="text-slate-300 mt-1 block font-mono">{selectedOrder.failedReason}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- RIDER STATUS UPDATE PROOF MODAL --- */}
      {riderProofModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white">
              {riderProofModal.action === 'deliver' ? 'Confirm Delivery Completion' : 'Log Delivery Failure'}
            </h3>

            {riderProofModal.action === 'deliver' ? (
              <div className="space-y-4">
                <p className="text-xs text-slate-400">Please provide a quick summary or verify the delivery handshake (e.g. "Left at front desk", "Signed by recipient").</p>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Proof / Notes</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Hand delivered to receptionist John"
                    value={proofText}
                    onChange={(e) => setProofText(e.target.value)}
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-purple-500 transition"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-slate-400">Please select the reason for dispatch failure:</p>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Reason</label>
                  <select
                    value={failReasonText}
                    onChange={(e) => setFailReasonText(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                  >
                    <option value="Client unavailable">Client unavailable / No response</option>
                    <option value="Address not found">Address not found / Invalid</option>
                    <option value="Package refused">Package refused by recipient</option>
                    <option value="Rider vehicle issue">Vehicle breakdown / Accident</option>
                  </select>
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end pt-4">
              <button
                onClick={() => setRiderProofModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={submitRiderProof}
                className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition cursor-pointer ${riderProofModal.action === 'deliver' ? 'bg-green-600 hover:bg-green-500' : 'bg-rose-600 hover:bg-rose-500'
                  }`}
              >
                Submit Update
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}