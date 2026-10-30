import { createContext, useContext } from 'react';

export const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// Grup sayfasi icindeyken grup id'si (Hesabim'da null); alt bilesenler istekleri ?group= ile kapsamlar
export const GroupCtx = createContext(null);
export const useGroup = () => useContext(GroupCtx);
