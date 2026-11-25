import { describe, expect, it } from 'vitest'
import { cleanMailBody, cutHtmlQuote, decodeHtmlEntities, htmlToText, isForwardSubject, stripQuotedReply, stripSignature } from './mailText'

const lines = (...l: string[]) => l.join('\n')

describe('réponses citées', () => {
  it('Gmail en français : coupe à « Le … a écrit : », même sur deux lignes', () => {
    const body = lines(
      'Bonjour Maël,',
      '',
      'Le bouton de connexion ne marche pas sur iPhone.',
      'Et le logo est trop petit sur la page d’accueil.',
      '',
      'Merci !',
      'Jeanne',
      '',
      'Le mar. 24 nov. 2026 à 18:02, Maël Auzenet <',
      'mael@sordulo.fr> a écrit :',
      '',
      '> Bonjour Jeanne,',
      '> Voici la nouvelle version de l’app.',
      '>',
    )
    expect(cleanMailBody({ text: body })).toBe(
      lines('Bonjour Maël,', '', 'Le bouton de connexion ne marche pas sur iPhone.', 'Et le logo est trop petit sur la page d’accueil.', '', 'Merci !', 'Jeanne'),
    )
  })

  it('Apple Mail et Gmail en anglais', () => {
    const apple = lines('Tout est bon pour moi, on valide.', '', 'Le 24 nov. 2026 à 18:02, Maël Auzenet <mael@sordulo.fr> a écrit :', '', '> Peux-tu valider ?')
    expect(cleanMailBody({ text: apple })).toBe('Tout est bon pour moi, on valide.')
    const english = lines('Please make the header sticky.', '', 'On Tue, Nov 24, 2026 at 6:02 PM Maël Auzenet <mael@sordulo.fr> wrote:', '> Here is the build.')
    expect(cleanMailBody({ text: english })).toBe('Please make the header sticky.')
  })

  it('Outlook : trait, puis « De : / Envoyé : / À : / Objet : »', () => {
    const body = lines(
      'Bonjour,',
      'Merci pour la maquette. Deux remarques : le vert est trop clair et le menu manque d’une entrée Contact.',
      '',
      '________________________________',
      'De : Maël Auzenet <mael@sordulo.fr>',
      'Envoyé : mardi 24 novembre 2026 18:02',
      'À : Jeanne Dupont <jeanne@ibe.fr>',
      'Objet : Maquettes v2',
      '',
      'Bonjour Jeanne, voici les maquettes.',
    )
    expect(cleanMailBody({ text: body })).toBe(
      lines('Bonjour,', 'Merci pour la maquette. Deux remarques : le vert est trop clair et le menu manque d’une entrée Contact.'),
    )
  })

  it('« -----Original Message----- » et en-têtes anglais sans trait', () => {
    expect(cleanMailBody({ text: lines('Ok pour jeudi.', '-----Original Message-----', 'From: Maël', 'Sent: Monday', 'To: Jeanne', 'Subject: Point') })).toBe('Ok pour jeudi.')
    expect(cleanMailBody({ text: lines('Ok pour jeudi.', '', 'From: Maël <mael@sordulo.fr>', 'Sent: Monday', 'To: Jeanne', 'Subject: Point', '', 'Hello') })).toBe(
      'Ok pour jeudi.',
    )
  })

  it('bloc final de lignes « > » sans introduction : retiré ; lignes « > » au milieu : gardées', () => {
    expect(stripQuotedReply(lines('Oui, rouge.', '', '> Le bouton doit être bleu ?', '> Merci'))).toBe(lines('Oui, rouge.'))
    const inline = lines('> Le bouton doit être bleu ?', 'Non, rouge.', '> Et le logo ?', 'Plus grand.')
    expect(cleanMailBody({ text: inline })).toBe(inline)
  })

  it('jamais de coupe sans texte avant (la citation en premier, réponses entre les lignes)', () => {
    const body = lines('Le 24 nov. 2026 à 18:02, Maël <mael@sordulo.fr> a écrit :', '> Bleu ou rouge ?', 'Rouge, merci.')
    expect(cleanMailBody({ text: body })).toBe(body)
  })

  it('une phrase qui commence par « Le » sans date n’est pas une citation', () => {
    const body = lines('Le client a écrit :', '« Le menu est confus »', 'Peux-tu regarder ?')
    expect(cleanMailBody({ text: body })).toBe(body)
  })

  it('transfert Gmail : le message transféré est gardé en entier', () => {
    const body = lines(
      'Je te transfère le retour de notre DG.',
      '',
      '---------- Forwarded message ---------',
      'De : Paul Martin <paul@ibe.fr>',
      'Date: mar. 24 nov. 2026 à 17:00',
      'Subject: Re: App',
      'To: Jeanne <jeanne@ibe.fr>',
      '',
      'Le menu est confus, il faut revoir la navigation.',
      '',
      'Le lun. 23 nov. 2026 à 10:00, Jeanne <jeanne@ibe.fr> a écrit :',
      '> Qu’en penses-tu ?',
    )
    expect(cleanMailBody({ text: body, subject: 'Fwd: App' })).toBe(body)
    expect(cleanMailBody({ text: body.replace('Forwarded message', 'Message transféré') })).toContain('Le menu est confus')
  })

  it('transfert Outlook (« TR: ») sans ligne de transfert : les en-têtes ouvrent le transfert, gardé', () => {
    const body = lines('Pour info, voir ci-dessous.', '', 'De : Paul Martin <paul@ibe.fr>', 'Envoyé : lundi 23 novembre 2026 10:00', 'À : Jeanne', 'Objet : App', '', 'Le menu est confus.')
    expect(cleanMailBody({ text: body, subject: 'TR: App' })).toBe(body)
    expect(isForwardSubject('TR : App')).toBe(true)
    expect(isForwardSubject('Fwd: App')).toBe(true)
    expect(isForwardSubject('Re: App')).toBe(false)
  })
})

describe('signatures', () => {
  it('« -- » et ce qui suit', () => {
    expect(stripSignature(lines('Le logo est flou.', '--', 'Jeanne Dupont', 'Ibé'))).toBe('Le logo est flou.')
  })

  it('Envoyé de mon iPhone, Sent from my, Obtenir Outlook pour iOS', () => {
    expect(cleanMailBody({ text: lines('Ok pour moi.', '', 'Envoyé de mon iPhone') })).toBe('Ok pour moi.')
    expect(cleanMailBody({ text: lines('Ok for me.', '', 'Sent from my Galaxy') })).toBe('Ok for me.')
    expect(cleanMailBody({ text: lines('Ok pour moi.', '', 'Obtenir Outlook pour iOS') })).toBe('Ok pour moi.')
  })

  it('« Cordialement » suivi de quelques lignes courtes en toute fin', () => {
    const body = lines(
      'Bonjour,',
      'La page Tarifs affiche encore les anciens prix.',
      '',
      'Cordialement,',
      'Jeanne Dupont',
      'Directrice marketing',
      'Ibé',
      '06 12 34 56 78',
    )
    expect(cleanMailBody({ text: body })).toBe(lines('Bonjour,', 'La page Tarifs affiche encore les anciens prix.'))
  })

  it('« Cordialement » suivi d’un long texte : rien n’est coupé', () => {
    const body = lines(
      'Bonjour,',
      'Cordialement',
      'Voici nos retours sur la version 2 : le formulaire de contact ne part pas quand on clique sur Envoyer depuis Safari.',
      'Le panier se vide quand on change de page, et le bouton Payer reste grisé même avec une carte valide.',
    )
    expect(cleanMailBody({ text: body })).toBe(body)
  })

  it('« Cordialement » suivi d’une question : rien n’est coupé', () => {
    const body = lines('Voici la liste.', 'Cordialement', 'Tu peux me rappeler ?')
    expect(stripSignature(body)).toBe(body)
  })

  it('un mail fait seulement de la signature reste tel quel', () => {
    const body = lines('Cordialement,', 'Jeanne')
    expect(cleanMailBody({ text: body })).toBe(body)
  })
})

describe('HTML', () => {
  it('convertit les paragraphes, retours, listes et entités', () => {
    const html =
      '<html><head><style>p{color:red}</style></head><body><div>Bonjour&nbsp;Maël,</div><div><br></div><p>Deux points&#160;:</p><ul><li>Le logo</li><li>Les couleurs &amp; la typo</li></ul><p>Merci d&rsquo;avance, l&#39;équipe Ibé</p></body></html>'
    expect(htmlToText(html)).toBe(lines('Bonjour Maël,', '', 'Deux points :', '', '- Le logo', '- Les couleurs & la typo', '', 'Merci d’avance, l\'équipe Ibé'))
    expect(decodeHtmlEntities('&eacute;t&eacute; &#x20AC; &inconnu;')).toBe('été € &inconnu;')
  })

  it('coupe la citation Gmail (gmail_quote) et Outlook (divRplyFwdMsg)', () => {
    const gmail = '<div dir="ltr">Le menu est trop chargé.</div><br><div class="gmail_quote"><div class="gmail_attr">Le mar. 24 nov. 2026, Maël a écrit :</div><blockquote>Voici la v2</blockquote></div>'
    expect(cleanMailBody({ html: gmail })).toBe('Le menu est trop chargé.')
    const outlook = '<p>Validé.</p><div id="divRplyFwdMsg"><b>De :</b> Maël</div><div>ancien message</div>'
    expect(cleanMailBody({ html: outlook })).toBe('Validé.')
  })

  it('transfert Gmail en HTML : rien n’est coupé', () => {
    const html = '<div>Pour info</div><div class="gmail_quote"><div>---------- Forwarded message ---------</div><div>Le menu est confus.</div></div>'
    expect(cutHtmlQuote(html)).toBe(html)
    expect(cleanMailBody({ html })).toContain('Le menu est confus.')
  })

  it('préfère le texte au HTML', () => {
    expect(cleanMailBody({ text: 'Version texte', html: '<p>Version HTML</p>' })).toBe('Version texte')
    expect(cleanMailBody({ text: '  ', html: '<p>Version HTML</p>' })).toBe('Version HTML')
    expect(cleanMailBody({})).toBe('')
  })
})
