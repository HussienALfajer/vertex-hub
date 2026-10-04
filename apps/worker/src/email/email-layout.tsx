import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { EmailAudience } from '@vertex-hub/contracts';
import { EMAIL_LAYOUT_TEXT, EMAIL_SENDER_NAMES, type EmailContent } from '@vertex-hub/messages';

/** The inline logo attachment the layout points at (`cid:`), as mail clients block SVG. */
export const LOGO_CID = 'logo@vertexmedia.pro';

/*
 * Brand colours (brand/identity.md §2) and a system font stack: no web fonts in emails (Q11).
 */
const COLORS = {
  green: '#004139',
  sand: '#B9A87A',
  background: '#F4F8F7',
  surface: '#FFFFFF',
  text: '#222827',
  muted: '#616866',
  border: '#D4DBD9',
} as const;

const FONT = "Tahoma, 'Segoe UI', Arial, sans-serif";

const styles = {
  body: { backgroundColor: COLORS.background, fontFamily: FONT, margin: 0, padding: '24px 0' },
  container: {
    backgroundColor: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '8px',
    maxWidth: '600px',
    padding: '32px',
  },
  header: { borderBottom: `3px solid ${COLORS.sand}`, paddingBottom: '16px', textAlign: 'right' },
  heading: { color: COLORS.green, fontSize: '22px', lineHeight: '32px', margin: '24px 0 16px' },
  paragraph: { color: COLORS.text, fontSize: '16px', lineHeight: '28px', margin: '0 0 12px' },
  button: {
    backgroundColor: COLORS.green,
    borderRadius: '6px',
    color: '#FFFFFF',
    fontSize: '16px',
    fontWeight: 600,
    padding: '12px 24px',
    textDecoration: 'none',
  },
  rule: { borderColor: COLORS.border, margin: '32px 0 16px' },
  footer: { color: COLORS.muted, fontSize: '13px', lineHeight: '20px', margin: '0 0 4px' },
} as const;

/**
 * Every email: RTL Arabic (`dir` repeated on the body and container: some clients drop it from
 * `<html>`), the green logo, the content, then the footer (ADR 0028).
 */
export function EmailLayout({
  audience,
  content,
}: {
  audience: EmailAudience;
  content: EmailContent;
}) {
  const layout = EMAIL_LAYOUT_TEXT[audience];
  return (
    <Html lang="ar" dir="rtl">
      <Head />
      <Preview>{content.subject}</Preview>
      <Body dir="rtl" style={styles.body}>
        <Container dir="rtl" style={styles.container}>
          <Section style={styles.header}>
            <Img src={`cid:${LOGO_CID}`} alt={EMAIL_SENDER_NAMES.client} width="72" height="73" />
          </Section>
          <Heading as="h1" style={styles.heading}>
            {content.heading}
          </Heading>
          {content.paragraphs.map((paragraph) => (
            <Text key={paragraph} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
          {content.action && (
            <Section style={{ margin: '24px 0' }}>
              <Button href={content.action.url} style={styles.button}>
                {content.action.label}
              </Button>
            </Section>
          )}
          <Hr style={styles.rule} />
          <Text style={styles.footer}>{layout.footer}</Text>
          <Text style={styles.footer}>{layout.reason}</Text>
        </Container>
      </Body>
    </Html>
  );
}
