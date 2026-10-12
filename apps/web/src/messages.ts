import { ApiError } from './api';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  unauthenticated: 'Sua sessão expirou. Entre de novo.',
  forbidden: 'Você não tem acesso a esta área.',
  not_found: 'Não encontrado.',
  invalid_request: 'Confira os campos e tente de novo.',
  email_taken: 'Este e-mail já está cadastrado.',
  slug_taken: 'Este endereço já está em uso por outro parceiro.',
  invalid_plan: 'Escolha um plano ativo.',
  invalid_period: 'A data de término precisa ser igual ou posterior à de início.',
  media_required: 'Envie uma imagem ou um vídeo antes de enviar para aprovação.',
  invalid_state: 'A situação desta campanha mudou. Atualize a página.',
  unsupported_media: 'Formato não aceito. Use JPEG, PNG, WebP ou vídeo MP4 (H.264).',
  file_too_large: 'O arquivo é maior que o limite permitido.',
  file_required: 'Escolha um arquivo.',
  invalid_document: 'CPF ou CNPJ inválido. Confira os números.',
  document_taken: 'Já existe um anunciante com este CPF/CNPJ.',
  has_subscriptions: 'Este anunciante tem campanhas; arquive em vez de excluir.',
  storage_full: 'O servidor está sem espaço para novos arquivos. Avise o administrador.',
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    return MESSAGES[err.code] ?? 'Algo deu errado. Tente de novo.';
  }
  return 'Algo deu errado. Tente de novo.';
}
