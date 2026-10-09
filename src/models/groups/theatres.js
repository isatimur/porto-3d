// Group "theatres": concert halls, theatres and cinemas.
import casaMusica from '../porto/casa-musica.js';
import coliseu from '../porto/coliseu.js';
import rivoli from '../porto/teatro-rivoli.js';
import batalha from '../porto/cinema-batalha.js';
import saDaBandeira from '../porto/teatro-sa-da-bandeira.js';
import saoJoao from '../porto/teatro-nacional-sao-joao.js';

export default { ...casaMusica, ...coliseu, ...rivoli, ...batalha, ...saDaBandeira, ...saoJoao };
