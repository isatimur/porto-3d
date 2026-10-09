// Group "bridges": the Douro bridges. One async chunk (src/models/loader.js).
// The main thread loads it at boot too: the pad rules of the four big
// bridges carry functions (rule.pad.level) that the terrain needs.
import luis from '../porto/ponte-luis-i.js';
import arrabida from '../porto/ponte-arrabida.js';
import mariaPia from '../porto/ponte-maria-pia.js';
import saoJoao from '../porto/ponte-sao-joao.js';
import infante from '../porto/ponte-infante.js';
import freixo from '../porto/ponte-freixo.js';

export default { ...luis, ...arrabida, ...mariaPia, ...saoJoao, ...infante, ...freixo };
