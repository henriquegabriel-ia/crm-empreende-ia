import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError } from '@supabase/supabase-js';
import { EmailCodeForm } from './EmailCodeForm';
import { AUTH_ERROR_MESSAGES } from '@/lib/auth-errors';

const mock = vi.hoisted(() => ({ verifyOtp: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { verifyOtp: mock.verifyOtp } } }));

const typeCode = (value: string) => fireEvent.change(screen.getByLabelText('Código do e-mail'), { target: { value } });
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Entrar com o código' }));

beforeEach(() => {
  mock.verifyOtp.mockReset().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
});

describe('código do e-mail (revisão de 13/10/2026)', () => {
  it('confere o código com o e-mail do envio e o tipo email, sem espaços nem hifens', async () => {
    render(<EmailCodeForm email="pessoa@example.test" />);
    const field = screen.getByLabelText('Código do e-mail');
    expect(field).toHaveAttribute('autocomplete', 'one-time-code');
    expect(field).toHaveAttribute('inputmode', 'numeric');
    expect(field).toHaveAccessibleDescription('Abriu o e-mail em outro aparelho? Digite aqui o código que veio nele.');
    typeCode(' 4820-3917 ');
    send();
    await waitFor(() =>
      expect(mock.verifyOtp).toHaveBeenCalledWith({ email: 'pessoa@example.test', token: '48203917', type: 'email' }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('recusa na tela o que não é um código de 6 a 10 dígitos, sem chamar o Auth', () => {
    render(<EmailCodeForm email="pessoa@example.test" />);
    for (const value of ['', '12345', '12345678901', '12ab5678']) {
      typeCode(value);
      send();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Digite só os números do código que veio no e-mail (de 6 a 10 dígitos).',
      );
    }
    expect(mock.verifyOtp).not.toHaveBeenCalled();
  });

  it('código errado, expirado ou já usado: o motivo em pt-BR, ligado ao campo', async () => {
    mock.verifyOtp.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthApiError('Token has expired or is invalid', 403, 'otp_expired'),
    });
    render(<EmailCodeForm email="pessoa@example.test" />);
    typeCode('12345678');
    send();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(AUTH_ERROR_MESSAGES.emailCodeInvalid);
    expect(screen.getByLabelText('Código do e-mail')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Código do e-mail').getAttribute('aria-describedby')).toContain(alert.id);
    expect(screen.getByRole('button', { name: 'Entrar com o código' })).toBeEnabled();
  });

  it('muitas tentativas: pede para aguardar', async () => {
    mock.verifyOtp.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit'),
    });
    render(<EmailCodeForm email="pessoa@example.test" />);
    typeCode('123456');
    send();
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.requestRateLimit);
  });
});
