import { Component, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  logoWhatsapp,
  closeOutline,
  send,
  paperPlaneOutline,
  checkmarkDoneOutline,
  searchOutline,
  happyOutline,
  attachOutline,
  micOutline,
  micOffOutline,
  radioOutline,
  sparkles,
  callOutline,
  videocamOutline,
  ellipsisVerticalOutline,
  shieldCheckmarkOutline,
  cubeOutline,
  chevronBackOutline,
  refreshOutline,
  cartOutline,
  cardOutline,
  cashOutline,
  checkmarkCircleOutline,
  volumeHighOutline
} from 'ionicons/icons';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { AuthService } from '../../../core/services/auth.service';
import { StoreService } from '../../../core/services/store.service';
import { WhatsAppCustomerConversation } from '../../../core/models/analytics.models';

@Component({
  selector: 'app-whatsapp-inquiry-modal',
  templateUrl: './whatsapp-inquiry-modal.component.html',
  styleUrls: ['./whatsapp-inquiry-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon]
})
export class WhatsAppInquiryModalComponent implements AfterViewChecked {
  @ViewChild('chatScrollArea') private chatScrollArea?: ElementRef<HTMLDivElement>;
  @ViewChild('audioFileInput') private audioFileInput?: ElementRef<HTMLInputElement>;

  inputText = '';
  searchQuery = '';
  showMobileChatThread = false;
  isRecording = false;
  recordingSeconds = 0;
  private recordingInterval: any = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private shouldScrollBottom = false;

  constructor(
    public analytics: AnalyticsService,
    public authService: AuthService,
    public storeService: StoreService
  ) {
    addIcons({
      logoWhatsapp,
      closeOutline,
      send,
      paperPlaneOutline,
      checkmarkDoneOutline,
      searchOutline,
      happyOutline,
      attachOutline,
      micOutline,
      micOffOutline,
      radioOutline,
      sparkles,
      callOutline,
      videocamOutline,
      ellipsisVerticalOutline,
      shieldCheckmarkOutline,
      cubeOutline,
      chevronBackOutline,
      refreshOutline,
      cartOutline,
      cardOutline,
      cashOutline,
      checkmarkCircleOutline,
      volumeHighOutline
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollBottom) {
      this.scrollToBottom();
      this.shouldScrollBottom = false;
    }
  }

  get filteredConversations(): WhatsAppCustomerConversation[] {
    const list = this.analytics.activeWhatsAppConversations();
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.customerName.toLowerCase().includes(q) ||
        c.customerPhone.includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q)
    );
  }

  selectConversation(conv: WhatsAppCustomerConversation): void {
    this.analytics.selectWhatsAppConversation(conv);
    this.showMobileChatThread = true;
    this.shouldScrollBottom = true;
  }

  backToChatList(): void {
    this.showMobileChatThread = false;
  }

  sendMessage(): void {
    const text = this.inputText.trim();
    if (!text || this.analytics.isSendingWhatsApp()) return;
    this.analytics.sendSimulatedCustomerMessage(text);
    this.inputText = '';
    this.shouldScrollBottom = true;

    setTimeout(() => {
      this.scrollToBottom();
    }, 1200);
  }

  sendQuickInquiry(prompt: string): void {
    this.inputText = prompt;
    this.sendMessage();
  }

  orderProductFromCard(product: any): void {
    this.inputText = `I would like to order "${product.title}" (${this.analytics.currencySymbol()}${product.price}) via Cash on Delivery. Please confirm booking.`;
    this.sendMessage();
  }

  triggerAudioUpload(): void {
    this.audioFileInput?.nativeElement.click();
  }

  onAudioFileSelected(event: any): void {
    const file = event.target?.files?.[0];
    if (file) {
      this.analytics.sendVoiceCustomerMessage(file);
      this.shouldScrollBottom = true;
      event.target.value = '';
    }
  }

  async toggleVoiceRecording(): Promise<void> {
    if (this.isRecording) {
      this.stopVoiceRecording();
    } else {
      await this.startVoiceRecording();
    }
  }

  private async startVoiceRecording(): Promise<void> {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Microphone access is not supported in this browser.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(stream);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());
        if (audioBlob.size > 0) {
          this.analytics.sendVoiceCustomerMessage(audioBlob);
          this.shouldScrollBottom = true;
        }
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordingSeconds = 0;
      this.recordingInterval = setInterval(() => {
        this.recordingSeconds++;
      }, 1000);
    } catch (err: any) {
      console.warn('[WhatsApp] Microphone access error:', err.message);
      // Fallback: prompt for text simulation or audio upload
      this.triggerAudioUpload();
    }
  }

  private stopVoiceRecording(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
    }
    this.isRecording = false;
    clearInterval(this.recordingInterval);
  }

  closeModal(): void {
    this.stopVoiceRecording();
    this.showMobileChatThread = false;
    this.inputText = '';
    this.searchQuery = '';
    this.analytics.closeWhatsAppModal();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('wa-modal-overlay')) {
      this.closeModal();
    }
  }

  stopPropagation(event: Event): void {
    event.stopPropagation();
  }

  private scrollToBottom(): void {
    if (this.chatScrollArea?.nativeElement) {
      this.chatScrollArea.nativeElement.scrollTop = this.chatScrollArea.nativeElement.scrollHeight;
    }
  }
}
