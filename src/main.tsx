import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './styles/eia-components.css';
import { installStaleBuildReload } from '@/lib/stale-build';

// Uma aba aberta antes de uma publicação nova recarrega sozinha uma vez quando uma tela não carrega mais (item 1.7b).
installStaleBuildReload();

createRoot(document.getElementById('root')!).render(<App />);
