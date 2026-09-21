import firebaseConfig from '../../firebase-applet-config.json';

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export class EmailService {
  private static tokenClient: any = null;

  static init() {
    if (this.tokenClient) return;

    if (!(window as any).google?.accounts?.oauth2) {
      console.warn('GSI library not loaded yet');
      return;
    }

    this.tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: firebaseConfig.oAuthClientId,
      scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',
      callback: () => {}, // Handled per request
    });
  }

  static async getToken(): Promise<string> {
    this.init();
    
    return new Promise((resolve, reject) => {
      this.tokenClient.callback = (response: any) => {
        if (response.error) {
          reject(response);
        } else {
          resolve(response.access_token);
        }
      };
      this.tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  static async sendEmail(params: SendEmailParams) {
    const token = await this.getToken();
    
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send email');
    }

    return response.json();
  }
}
