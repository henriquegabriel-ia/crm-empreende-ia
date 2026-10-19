import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Bug } from 'lucide-react';
import { Button } from '@/components/ds/button';
import { SUPPORT_EMAIL } from '@/lib/support';
import {
  OFFLINE_ERROR_BACK_TEXT,
  OFFLINE_ERROR_BACK_TITLE,
  OFFLINE_ERROR_TEXT,
  OFFLINE_ERROR_TITLE,
  browserOffline,
} from '@/lib/offline';

// Sem conexão, a tela de erro diz isso e só deixa recarregar quando a conexão volta (achado 4 da revisão do 1.7b,
// corrigido no 1.7a): recarregar sem internet trocaria o CRM pela página de erro de rede do navegador, o que
// src/lib/stale-build.ts evita de propósito. O botão volta no evento `online`, sem recarregar sozinho. O título vem de
// quando o erro aconteceu (`failedOffline`), e não da conexão de agora: um erro de verdade com a conexão caída depois
// continua "Algo deu errado", e a tela que não abriu sem conexão diz "A conexão voltou" quando ela volta.

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  resetKey?: string | number;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string;
  lastResetKey?: string | number;
  offline: boolean;
  failedOffline: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorId: '',
      lastResetKey: props.resetKey,
      offline: browserOffline(),
      failedOffline: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    const errorId = `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    return { hasError: true, error, errorId, offline: browserOffline(), failedOffline: browserOffline() };
  }

  componentDidMount() {
    window.addEventListener('online', this.updateConnection);
    window.addEventListener('offline', this.updateConnection);
  }

  componentWillUnmount() {
    window.removeEventListener('online', this.updateConnection);
    window.removeEventListener('offline', this.updateConnection);
  }

  private updateConnection = () => {
    if (this.state.offline !== browserOffline()) this.setState({ offline: browserOffline() });
  };

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.lastResetKey) {
      return { hasError: false, error: null, errorId: '', lastResetKey: props.resetKey, failedOffline: false };
    }
    return null;
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', this.state.errorId, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const { offline, failedOffline } = this.state;
      const title = failedOffline ? (offline ? OFFLINE_ERROR_TITLE : OFFLINE_ERROR_BACK_TITLE) : 'Algo deu errado';
      const hint = offline
        ? OFFLINE_ERROR_TEXT
        : failedOffline
          ? OFFLINE_ERROR_BACK_TEXT
          : 'Um erro inesperado ocorreu neste componente. Tente recarregar a página.';

      return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center" role="alert">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p id="error-boundary-hint" className="mt-1 max-w-md text-sm text-muted-foreground">
            {hint}
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">ID do erro: {this.state.errorId}</p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offline}
              aria-describedby={offline ? 'error-boundary-hint' : undefined}
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Recarregar
            </Button>
            {SUPPORT_EMAIL && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // O e-mail chega ao suporte da empresa (supportEmail do brand.json): assunto em pt-BR, como o CRM.
                  const subject = encodeURIComponent(`Erro no CRM: ${this.state.errorId}`);
                  const body = encodeURIComponent(
                    `Erro: ${this.state.error?.message}\n\nID: ${this.state.errorId}\nURL: ${window.location.href}`,
                  );
                  window.open(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
                }}
              >
                <Bug className="mr-2 h-4 w-4" />
                Reportar
              </Button>
            )}
          </div>
          {!SUPPORT_EMAIL && (
            <p className="mt-4 text-sm text-muted-foreground">
              Se o erro continuar, informe este código a quem administra o CRM.
            </p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
