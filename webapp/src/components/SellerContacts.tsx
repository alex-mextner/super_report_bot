import { useTelegram } from "../hooks/useTelegram";
import type { SellerContact } from "../types";
import "./SellerContacts.css";

interface Props {
  contacts: SellerContact[];
}

function getContactIcon(type: string): string {
  switch (type) {
    case "phone":
      return "tel";
    case "username":
    case "telegram_link":
    case "profile":
      return "tg";
    case "whatsapp":
      return "wa";
    default:
      return "link";
  }
}

function getContactLabel(type: string): string {
  switch (type) {
    case "phone":
      return "Телефон";
    case "username":
      return "Telegram";
    case "telegram_link":
      return "Ссылка TG";
    case "profile":
      return "Профиль";
    case "whatsapp":
      return "WhatsApp";
    default:
      return "Контакт";
  }
}

function getContactHref(contact: SellerContact): string {
  if (contact.contact_type === "phone") {
    return `tel:${contact.contact_value}`;
  }
  if (contact.contact_type === "username") {
    return `https://t.me/${contact.contact_value.replace("@", "")}`;
  }
  return contact.contact_value;
}

export function SellerContacts({ contacts }: Props) {
  const { openLink } = useTelegram();

  if (contacts.length === 0) {
    return null;
  }

  const handleClick = (contact: SellerContact) => {
    const href = getContactHref(contact);
    if (href.startsWith("https://t.me") || href.startsWith("tg://")) {
      openLink(href);
    } else {
      window.open(href, "_blank");
    }
  };

  return (
    <div className="seller-contacts">
      <h3 className="contacts-title">Контакты продавца</h3>
      <div className="contacts-list">
        {contacts.map((contact) => (
          <button
            key={contact.id}
            className={`contact-btn contact-${getContactIcon(contact.contact_type)}`}
            onClick={() => handleClick(contact)}
          >
            <span className="contact-label">{getContactLabel(contact.contact_type)}</span>
            <span className="contact-value">{contact.contact_value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
